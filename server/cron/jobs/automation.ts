/**
 * The automation pipeline's two cron halves: the sweep that ENQUEUES reminder
 * logs and the flush that DELIVERS every due log.
 *
 * They are separate jobs because they fail for unrelated reasons - one reads
 * rules and inspections, the other talks to mail and SMS providers - and a
 * delivery outage must not also stop reminders being scheduled.
 */
import { and, eq } from 'drizzle-orm';
import { automationLogs, automations } from '../../lib/db/schema/inspection/automation';
import { AutomationService } from '../../services/automation.service';
import { maybeMetering } from '../../services/metering.service';
import { buildTenantEmailService } from '../../lib/email/build-email-service';
import type { EmailServiceEnv } from '../../lib/email/build-email-service';
import { PlanQuotaGuard, readTenantTier } from '../../features/plan-quota/guard';
import { tenantAiCapsLoader } from '../../features/plan-quota/ai-caps';
import { getDeploymentProfile } from '../../lib/deployment-profile';
import { PortalAccessService } from '../../services/portal-access.service';
import { ReportPdfService } from '../../services/report-pdf.service';
import { InspectionService } from '../../services/inspection.service';
import type { ReportDeliveryDeps } from '../../services/automation/report-email';
import { logger } from '../../lib/logger';
import { TICK, db, exists, type CronJob } from '../types';

/**
 * Automation log rows delivered per flush invocation.
 *
 * UNMEASURED against the CPU ceiling. It is the batch size flush() has always
 * been given, and it is also the size the sibling Worker's five jobs all use
 * under the same 10 ms limit — so it is a value with a track record rather than
 * one with a measurement. Declared once, because the registry's stated cap and
 * the number actually passed drifting apart would make the cap a comment.
 */
const FLUSH_BATCH = 50;

// 3a. Track J — enqueue inspection.reminder logs (no email key needed to enqueue;
//     the flush below sends due ones). Idempotent per (rule, inspection).
export const reminderEnqueueJob: CronJob = {
    key: 'reminder-enqueue',
    label: 'Enqueue inspection.reminder automation logs',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: 50,
    // enqueueReminders() returns 0 immediately when no active reminder rule
    // exists, so that is exactly the due-check — one indexed LIMIT 1.
    probe: (env) => exists(
        db(env).select({ id: automations.id })
            .from(automations)
            .where(and(eq(automations.trigger, 'inspection.reminder'), eq(automations.active, true)))
            .limit(1).get(),
    ),
    run: async (env) => {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        const n = await svc.enqueueReminders(Date.now());
        if (n > 0) logger.info('[cron] enqueued inspection reminders', { count: n });
        return { processed: n, nextCursor: null };
    },
};

// 3. Automation queue flush (email + SMS). Always runs: email logs self-skip
//    when RESEND_API_KEY is empty; SMS logs resolve their own per-tenant Twilio
//    creds (platform env or tenant own) via the runtime built from env below.
export const automationFlushJob: CronJob = {
    key: 'automation-flush',
    label: 'Deliver due automation logs (email + SMS + in-app)',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: FLUSH_BATCH,
    // A superset of flush()'s two due-queries: both start from
    // `status = 'pending'`, and the reminder half re-derives its due moment
    // live from the inspection date, which no probe can cheaply predict. A
    // superset over-enqueues at worst — one empty batch — where a subset
    // would silently withhold mail.
    probe: (env) => exists(
        db(env).select({ id: automationLogs.id })
            .from(automationLogs)
            .where(eq(automationLogs.status, 'pending'))
            .limit(1).get(),
    ),
    run: async (env, _cursor) => {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        // Provider-aware: loadProviderForTenant reads sms_byo_provider from tenant_configs
        // and routes to TwilioClient (default) or TelnyxProvider. The Twilio path is
        // byte-identical — the same resolveTwilio() logic runs inside.
        const sms = (env.TENANT_CACHE && env.JWT_SECRET)
            ? {
                resolveProvider: (tenantId: string) =>
                    import('../../lib/sms/resolve-twilio').then(({ loadProviderForTenant }) =>
                        loadProviderForTenant({
                            DB: env.DB, TENANT_CACHE: env.TENANT_CACHE!, JWT_SECRET: env.JWT_SECRET!,
                            ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}),
                            ...(env.TWILIO_ACCOUNT_SID ? { TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID } : {}),
                            ...(env.TWILIO_AUTH_TOKEN ? { TWILIO_AUTH_TOKEN: env.TWILIO_AUTH_TOKEN } : {}),
                            ...(env.TWILIO_FROM_NUMBER ? { TWILIO_FROM_NUMBER: env.TWILIO_FROM_NUMBER } : {}),
                        }, tenantId)),
            }
            : null;
        // Pass the managed-send gate env so managed_shared and managed_dedicated
        // automation sends are fail-closed until compliance is approved.
        const gateEnv = {
            ...(env.TWILIO_SHARED_MESSAGING_SERVICE_SID
                ? { TWILIO_SHARED_MESSAGING_SERVICE_SID: env.TWILIO_SHARED_MESSAGING_SERVICE_SID }
                : {}),
        };
        // Free-tier pre-flight (2026-07): cron has no Hono context/profile, so
        // it reads the env->capability seam directly — the sanctioned form for
        // context-free code (OI #308 §6.1). ScheduledEnv satisfies ProfileEnv
        // structurally; the cast this needed before #308 is gone.
        // The per-tenant tier is resolved inside the flush() email factory,
        // which memoizes one EmailService per tenantId per flush() call, so
        // this is one lookup per tenant per tick, not per log row. The SMS
        // branch (deliverSms) reads tier straight off the already-joined
        // `tenant.tier` column — no extra lookup needed there.
        const profile = getDeploymentProfile(env);
        const quotaGuard = profile.hasUsageQuota
            ? new PlanQuotaGuard(env.DB, { enforced: true, billingPortalUrl: profile.billingPortalUrl, aiCaps: tenantAiCapsLoader(env.DB) })
            : undefined;
        const appBaseUrl = env.APP_BASE_URL || '';
        // Spec 2 Task 2b — report.published PDF-email delivery deps. Guarded on
        // JWT_SECRET (required in prod; absent only in an unconfigured/standalone
        // dev deploy) — when absent, reportDelivery is undefined and flush() falls
        // back to the generic template path for report.published emails (no crash).
        const appHostForRender = (() => {
            try { return new URL(appBaseUrl).host; } catch { return appBaseUrl.replace(/^https?:\/\//, '').replace(/\/$/, ''); }
        })();
        const reportDelivery: ReportDeliveryDeps | undefined = env.JWT_SECRET ? {
            portalAccess: new PortalAccessService(env.DB, {
                jwtSecret: env.JWT_SECRET,
                ...(env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: env.JWT_SECRET_PREVIOUS } : {}),
            }),
            reportPdf: new ReportPdfService(env.DB, env.BROWSER, env.PHOTOS),
            getContentHash: (inspectionId: string, tenantId: string) =>
                new InspectionService(
                    env.DB, env.PHOTOS,
                    /* sdb */ undefined, env.TENANT_CACHE, /* IMAGES */ undefined, /* quota */ undefined,
                    env.KEY_ENCRYPTION_SECRET || env.JWT_SECRET,
                ).getReportContentHash(inspectionId, tenantId),
            renderHost: appHostForRender,
            renderSecret: env.JWT_SECRET,
        } : undefined;
        await svc.flush(
            async (tid) => {
                const tier = quotaGuard ? await readTenantTier(env.DB, tid) : undefined;
                return buildTenantEmailService(env as EmailServiceEnv, tid, quotaGuard, tier);
            },
            env.APP_NAME || 'OpenInspection',
            appBaseUrl,
            sms,
            FLUSH_BATCH,
            gateEnv,
            quotaGuard,
            reportDelivery,
        );
        return { processed: 1, nextCursor: null };
    },
};
