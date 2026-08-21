import { drizzle } from 'drizzle-orm/d1';
import { AutomationService } from './services/automation.service';
import { maybeMetering } from './services/metering.service';
import { AgreementService } from './services/agreement.service';
import { buildTenantEmailService } from './lib/email/build-email-service';
import type { EmailServiceEnv } from './lib/email/build-email-service';
import type { DailyRetentionEnv } from './lib/cron/daily-retention-tasks';
import { PlanQuotaGuard, readTenantTier } from './features/plan-quota/guard';
import { tenantAiCapsLoader } from './features/plan-quota/ai-caps';
import { getDeploymentProfile } from './lib/deployment-profile';
import type { BrowserRun } from './types/hono';
import { runQBOCDC } from './services/qbo/cron-cdc';
import { logger } from './lib/logger';
import type { SyncEnvelope } from './lib/sync-events/envelope';
// Spec 2 Task 2b — cron-path deps for report.published PDF-email delivery
// (see services/automation/report-email.ts:ReportDeliveryDeps).
import { PortalAccessService } from './services/portal-access.service';
import { ReportPdfService } from './services/report-pdf.service';
import { InspectionService } from './services/inspection.service';
import type { ReportDeliveryDeps } from './services/automation/report-email';

export interface ScheduledEnv {
    DB: D1Database;
    APP_MODE?: string;
    PHOTOS?: R2Bucket;
    RESEND_API_KEY?: string;
    SENDER_EMAIL?: string;
    APP_NAME?: string;
    APP_BASE_URL?: string;
    JWT_SECRET?: string;
    JWT_SECRET_PREVIOUS?: string;
    QBO_CLIENT_ID?: string;
    QBO_CLIENT_SECRET?: string;
    QBO_ENV?: string;
    QBO_WEBHOOK_SECRET?: string;
    // Track L — platform-default Twilio creds + the KV used by loadTwilioForTenant
    // to read per-tenant secrets. The cron SMS runtime is built only when both
    // TENANT_CACHE and JWT_SECRET are present (else SMS logs self-skip 'not configured').
    TWILIO_ACCOUNT_SID?: string;
    TWILIO_AUTH_TOKEN?: string;
    TWILIO_FROM_NUMBER?: string;
    // Managed-pool ISV credentials (same as in AppEnv). Required for the managed
    // compliance cron sweep (Task 7). Absent in standalone → sweep skips silently.
    TWILIO_API_KEY_SID?: string;
    TWILIO_API_KEY_SECRET?: string;
    /** Managed-ISV Telnyx API key (Plan 2) — drives the Telnyx managed compliance
     *  sweep. Absent in standalone / Twilio-only deploys → Telnyx rows skip. */
    TELNYX_API_KEY?: string;
    /** Shared Messaging Service SID for managed_shared tenants (Task 8 send gate). */
    TWILIO_SHARED_MESSAGING_SERVICE_SID?: string;
    TENANT_CACHE?: KVNamespace;
    /** Platform Google OAuth client, for the calendar sync sweep. Tenants with
     *  their OWN client are resolved from encrypted tenant secrets instead. */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    // Core -> portal user-sync transport (A-13/A-14). Producer binding to the
    // sync queue; the outbox sweeper republishes pending rows through it.
    // Optional — sweeper is a no-op when missing (standalone).
    SYNC_QUEUE?: Queue<SyncEnvelope>;
    // Spec 2 Task 2b — report.published PDF-email delivery deps (ReportPdfService
    // + InspectionService.getReportContentHash). Absent → the cron flush() falls
    // back to the generic template path (see reportDelivery construction below).
    BROWSER?: BrowserRun;
    KEY_ENCRYPTION_SECRET?: string;
}

async function cleanupPendingAttachments(photos: R2Bucket): Promise<void> {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    let cursor: string | undefined = undefined;
    let deleted = 0;
    do {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const list: R2Objects = await (photos as any).list({ cursor, limit: 1000 });
        for (const obj of list.objects) {
            if (obj.key.includes('/messages/_pending/') && obj.uploaded.getTime() < cutoff) {
                await photos.delete(obj.key);
                deleted++;
            }
        }
        cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);
    if (deleted > 0) logger.info('[cron] cleaned up _pending message attachments', { deleted });
}

export async function scheduled(
    _event: ScheduledEvent,
    env: ScheduledEnv,
    _ctx: ExecutionContext,
): Promise<void> {
    // Single unified cron (recommended: `*/5 * * * *`) — runs all
    // periodic tasks each tick. All jobs are idempotent and the
    // increased frequency for the daily/hourly ones is harmless:
    //   - agreementService.expireOlderThan is a WHERE-filtered UPDATE
    //     that no-ops once the rows are already expired.
    //   - runQBOCDC processes only connections with new CDC entries
    //     since last sync; cost is proportional to actual change.
    // If you have spare CF cron triggers, you can split this back out
    // (see git history for the per-cron-expression branching version).

    // 1. Agreement expiry (Spec 2A — was daily 02:00 UTC)
    try {
        const agreementService = new AgreementService(
            env.DB,
            env.JWT_SECRET ? { jwtSecret: env.JWT_SECRET, ...(env.JWT_SECRET_PREVIOUS ? { jwtSecretPrevious: env.JWT_SECRET_PREVIOUS } : {}) } : undefined,
        );
        const count = await agreementService.expireOlderThan(14);
        if (count > 0) logger.info('[cron] expired agreements', { count });
    } catch (e) {
        logger.error('[cron] agreement expiry failed', {}, e instanceof Error ? e : undefined);
    }

    // 2. QBO CDC payment sync (was hourly)
    try {
        await runQBOCDC(env);
    } catch (e) {
        logger.error('[cron] QBO CDC failed', {}, e instanceof Error ? e : undefined);
    }

    // 3a. Track J — enqueue inspection.reminder logs (no email key needed to enqueue;
    //     the flush below sends due ones). Idempotent per (rule, inspection).
    try {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        const n = await svc.enqueueReminders(Date.now());
        if (n > 0) logger.info('[cron] enqueued inspection reminders', { count: n });
    } catch (e) {
        logger.error('[cron] reminder enqueue failed', {}, e instanceof Error ? e : undefined);
    }

    // 3. Automation queue flush (email + SMS). Always runs: email logs self-skip
    //    when RESEND_API_KEY is empty; SMS logs resolve their own per-tenant Twilio
    //    creds (platform env or tenant own) via the runtime built from env below.
    try {
        const svc = new AutomationService(env.DB, undefined, undefined, maybeMetering(env));
        // Provider-aware: loadProviderForTenant reads sms_byo_provider from tenant_configs
        // and routes to TwilioClient (default) or TelnyxProvider. The Twilio path is
        // byte-identical — the same resolveTwilio() logic runs inside.
        const sms = (env.TENANT_CACHE && env.JWT_SECRET)
            ? {
                resolveProvider: (tenantId: string) =>
                    import('./lib/sms/resolve-twilio').then(({ loadProviderForTenant }) =>
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
            50,
            gateEnv,
            quotaGuard,
            reportDelivery,
        );
    } catch (e) {
        logger.error('[cron] automation flush failed', {}, e instanceof Error ? e : undefined);
    }

    // 4. Sweep the user-sync outbox onto the sync queue (no-op for standalone —
    //    gated on SYNC_QUEUE, the producer binding present only in saas).
    if (env.SYNC_QUEUE) {
        try {
            const { drainPortalOutbox } = await import('./portal/integration.module');
            await drainPortalOutbox(env);
        } catch (err) {
            logger.error('[cron:outbox] sweeper threw', {}, err instanceof Error ? err : undefined);
        }
    }

    // 5. Clean up abandoned _pending message attachments older than 24h
    try {
        if (env.PHOTOS) await cleanupPendingAttachments(env.PHOTOS);
    } catch (e) {
        logger.error('[cron] _pending cleanup failed', {}, e instanceof Error ? e : undefined);
    }

    // 5a-bis. Turn sold service lines into reports for orders whose scheduled
    //     start has arrived. Deliberately not at booking: a report that
    //     materialises weeks early clutters the order and freezes a template the
    //     tenant may still be editing. Latched per inspection, so a re-run is a
    //     no-op rather than a re-titling of documents someone has filled in.
    try {
        const { sweepScheduledReportGeneration } = await import('./lib/inspection/report-generation');
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generated = await sweepScheduledReportGeneration(drizzle(env.DB) as any, Date.now());
        if (generated > 0) logger.info('[cron] generated reports from sold services', { inspections: generated });
    } catch (e) {
        logger.error('[cron] report generation sweep failed', {}, e instanceof Error ? e : undefined);
    }

    // 5b. Background GC of orphaned inspection R2 blobs (Q8). Idempotent; grace-windowed.
    try {
        if (env.PHOTOS) {
            const { sweepOrphanedMedia } = await import('./lib/media/sweep-orphans');
            const reaped = await sweepOrphanedMedia(env.DB, env.PHOTOS, Date.now());
            if (reaped > 0) logger.info('[cron] reaped orphaned R2 blobs', { reaped });
        }
    } catch (e) {
        logger.error('[cron] orphan GC failed', {}, e instanceof Error ? e : undefined);
    }

    // 5c. Managed compliance status poll (Task 7 / Plan 2) — re-read brand/campaign/
    //     TFV status from the carrier for non-terminal managed rows. The sweep builds
    //     the provider PER ROW by messaging_compliance.provider, so a mixed Twilio +
    //     Telnyx fleet is reconciled in one pass. Runs when EITHER the Twilio ISV
    //     triple OR TELNYX_API_KEY is present (so a Telnyx-only deploy still sweeps);
    //     a row whose carrier has no configured creds is skipped fail-soft. Skipped
    //     entirely when none are present (standalone / unconfigured saas).
    const twilioIsvConfigured = !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_API_KEY_SID && env.TWILIO_API_KEY_SECRET);
    if (twilioIsvConfigured || env.TELNYX_API_KEY) {
        try {
            const { MessagingComplianceService } = await import('./services/messaging-compliance.service');
            const svc = new MessagingComplianceService(env.DB);
            // Pass an outbox when the sync queue is bound (SaaS) so status transitions
            // are propagated to portal. Absent in standalone — no-op (outbox = undefined).
            // Dynamic import keeps portal code out of the standalone bundle by construction.
            const outbox = env.SYNC_QUEUE
                ? await import('./portal/integration.module').then(({ buildUserSyncOutbox }) => buildUserSyncOutbox(env))
                : undefined;
            const resolverEnv = {
                TWILIO_ACCOUNT_SID: env.TWILIO_ACCOUNT_SID,
                TWILIO_API_KEY_SID: env.TWILIO_API_KEY_SID,
                TWILIO_API_KEY_SECRET: env.TWILIO_API_KEY_SECRET,
                TELNYX_API_KEY: env.TELNYX_API_KEY,
            };
            await svc.sweepManagedStatuses(resolverEnv, outbox);
        } catch (e) {
            logger.error('[cron] managed compliance sweep failed', {}, e instanceof Error ? e : undefined);
        }
    }

    // 5d. Pull each connected inspector's Google busy time on a schedule, so
    //     "Sync now" stops being something anyone has to remember. Body lives
    //     in lib/calendar/sync-sweep; it never throws and records its own
    //     per-connection failures as last_sync_error.
    if (env.TENANT_CACHE && env.JWT_SECRET) {
        const { sweepCalendarSyncs } = await import('./lib/calendar/sync-sweep');
        const swept = await sweepCalendarSyncs({
            DB: env.DB, TENANT_CACHE: env.TENANT_CACHE, JWT_SECRET: env.JWT_SECRET,
            ...(env.JWT_SECRET_PREVIOUS ? { JWT_SECRET_PREVIOUS: env.JWT_SECRET_PREVIOUS } : {}),
            ...(env.GOOGLE_CLIENT_ID ? { GOOGLE_CLIENT_ID: env.GOOGLE_CLIENT_ID } : {}),
            ...(env.GOOGLE_CLIENT_SECRET ? { GOOGLE_CLIENT_SECRET: env.GOOGLE_CLIENT_SECRET } : {}),
        });
        if (swept.attempted > 0) logger.info('[cron] calendar sync sweep', swept);
    }

    // 6. Track I-a GDPR retention sweep (spec §7) — final destruction of
    //    past-window signed-agreement signatures (signature_base64 -> NULL +
    //    purged_at marker). Keeps the esign_audit_logs chain. Idempotent,
    //    tenant-batched (single grouped query joined to tenant_configs).
    try {
        const { runRetentionSweep } = await import('./lib/compliance/retention-sweep');
         
        // PHOTOS was already in scope here and simply never passed. The sweep
        // now destroys signed.pdf, certificate.pdf and evidence.zip in the same
        // pass that nulls the signature column — counsel round 26: nulling the
        // column while the PDF still embeds the same image is database
        // retention wearing the name of retention.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const agreementSweepDb = drizzle(env.DB) as any;
        const summary = await runRetentionSweep(
            agreementSweepDb, Date.now(), { photos: env.PHOTOS },
        );
        if (summary.purgedEnvelopes > 0) {
            logger.info('[cron] retention sweep purged signatures', summary);
        }
    } catch (e) {
        logger.error('[cron] retention sweep failed', {}, e instanceof Error ? e : undefined);
    }

    // 6b. OI #276 — log-table retention (RETENTION_MANIFEST), plus the intake
    //     expiry reminder that rides the same tick. Separate from block 6
    //     because that one is the per-tenant AGREEMENT clock keyed on a
    //     purged_at marker; these are fixed platform windows. One block cannot
    //     hold two definitions of "due".
    //     Once-daily at 04:00, not every tick: a clock in days and months gains
    //     nothing from 288 passes a day, and 04:00 keeps this full-table scan
    //     off the same 5-minute budget as the 03:00 one below (block 7's
    //     pattern). Always-on in both modes — storage limitation is not a
    //     topology question. Idempotent, and each half wraps its own failure.
    //     Only the SCHEDULE is here; the work is one module away, so it can be
    //     run on demand without waiting for four in the morning.
    {
        const at = new Date();
        if (at.getUTCHours() === 4 && at.getUTCMinutes() < 5) {
            const { runDailyRetentionTasks } = await import('./lib/cron/daily-retention-tasks');
            // The same cast `buildTenantEmailService` is given above, for the
            // same reason: `ScheduledEnv` declares the mail bindings optional
            // because most cron blocks do not send, while this one does — its
            // expiry reminder goes out as email built for the tenant. On a
            // deployment genuinely missing `TENANT_CACHE` the mailer throws
            // into that block's own try/catch and is logged, which is the loud
            // failure we want rather than a sweep that quietly stops chasing.
            await runDailyRetentionTasks(env as DailyRetentionEnv, at);
        }
    }

    // 7. Daily R2 usage measurement (03:00–03:05 UTC window fires once/day on the
    //    */5 cron). Writes r2_bytes gauge per tenant via MeteringService. Runs in
    //    every mode — standalone simply has one tenant in the table, so it records a
    //    single whole-instance measurement, populating the /settings/usage Storage
    //    figure everywhere.
    {
        const now = new Date();
        if (now.getUTCHours() === 3 && now.getUTCMinutes() < 5) {
            try {
                const { drizzle: drizzleR2 } = await import('drizzle-orm/d1');
                const { tenants } = await import('./lib/db/schema/tenant');
                const { MeteringService } = await import('./services/metering.service');
                const { R2UsageService } = await import('./services/r2-usage.service');
                const ids = (await drizzleR2(env.DB).select({ id: tenants.id }).from(tenants).all()).map(r => r.id);
                await new R2UsageService(env.PHOTOS!, new MeteringService(env.DB)).measureAll(ids);
                logger.info('[usage] R2 measurement complete', { tenants: ids.length });
            } catch (err) {
                logger.error('[usage] R2 measurement failed', {}, err instanceof Error ? err : undefined);
            }
        }
    }
}
