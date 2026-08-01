import { eq } from 'drizzle-orm';
import { automationLogs, tenantConfigs } from '../../lib/db/schema';
import { resolveTenantTimeZone } from '../../lib/tz';
import { resolveLocale } from '../../lib/locale';
import { formatDateTime } from '../../lib/format';
import { logger } from '../../lib/logger';
import { deliverAction } from '../../lib/automation-core';
import { buildBaseTemplateVars } from './template-vars';
import { createOiTemplateStore } from './template-store';
import { automationClassId } from '../../lib/notifications/automation-classes';
import { oiClock } from './shared';
import type { FlushInspection } from './shared';
import type { EmailService } from '../email.service';
import type { automations, automationLogs as automationLogsTable, tenants } from '../../lib/db/schema';

/**
 * The generic templated-email path of flush(), extracted from delivery.ts for
 * the file-size ratchet — same caller, same behaviour, no split in
 * responsibility. (report-email.ts came out of the same function for the same
 * reason; this is the branch it falls through to.)
 *
 * Every exit writes the log row's outcome, because a caller that had to
 * interpret a return value would be a second place where "what happened to
 * this send" is decided.
 */
export interface TemplatedEmailDeps {
    /** Raw D1 handle — the template store builds its own drizzle instance. */
    rawDb: D1Database;
    agreementService: { findOrCreate(tenantId: string, inspectionId: string): Promise<{ token: string }> } | undefined;
    /** Latest report_versions summary, memoized per inspection by the caller. */
    latestSummary: (inspectionId: string, tenantId: string) => Promise<string>;
    emailSvc: EmailService;
    appName: string;
    appHost: string;
    appBaseUrl: string;
}

export async function deliverTemplatedEmail(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    ctx: {
        log: typeof automationLogsTable.$inferSelect;
        automation: typeof automations.$inferSelect | null;
        inspection: FlushInspection;
        tenant: typeof tenants.$inferSelect;
    },
    deps: TemplatedEmailDeps,
): Promise<void> {
    const { log, automation, inspection, tenant } = ctx;
    const { appName, appHost, appBaseUrl, emailSvc } = deps;
    // SP2 — resolve the referenced email template (replaces the
    // embedded subject_template / body_template, now frozen DEAD).
    // Skip fail-closed when the rule has no resolvable email template.
    const store = createOiTemplateStore(deps.rawDb);
    // No rule means no referenced template, which lands on the
    // same fail-closed skip a rule with no template gets. One
    // outcome, one reason string, whichever way it got here.
    const tpl = automation?.emailTemplateId
        ? await store.resolve(inspection.tenantId, automation.emailTemplateId)
        : null;
    if (!tpl || tpl.channel !== 'email') {
        await db.update(automationLogs).set({ status: 'skipped', error: 'no email template' })
            .where(eq(automationLogs.id, log.id));
        return;
    }
    const subjectSource = tpl.subject ?? '';
    const bodySource = tpl.body;

    const vars: Record<string, string> = {
        ...buildBaseTemplateVars(inspection, tenant, appName, appHost, {
            summary: automation?.trigger === 'report.amended'
                ? await deps.latestSummary(inspection.id, inspection.tenantId)
                : '',
        }),
        inspector_name:   '',
        invoice_url:      `${appBaseUrl}/invoices`,
        payment_url:      `${appBaseUrl}/invoices`,
        // Spec 4D — event-related vars (populated below if log.eventId set)
        event_type_name:      '',
        event_scheduled_at:   '',
        event_inspector_name: '',
    };

    // Spec 4D — populate event vars when log was created by EventService.
    // Spec 4D event-vars apply only to logs linked to a real inspection
    // event. Track J reminders reuse event_id as a "reminder:<rule>:<insp>"
    // dedup key that never matches an inspectionEvents row, so skip the
    // lookup. Spec 2 Task 3 — report.published logs reuse event_id the same
    // way with an "auto:report.published:<insp>" dedup key (see trigger.ts);
    // also never a real inspectionEvents row, so skip it too.
    if (log.eventId && !log.eventId.startsWith('reminder:') && !log.eventId.startsWith('auto:')) {
        try {
            const { eventTypes, inspectionEvents } = await import('../../lib/db/schema');
            const ev = await db.select().from(inspectionEvents).where(eq(inspectionEvents.id, log.eventId)).get();
            if (ev) {
                const et = await db.select().from(eventTypes).where(eq(eventTypes.id, ev.eventTypeId as string)).get();
                vars.event_type_name    = (et?.name as string) ?? '';
                // Format the client-facing scheduled time in the RECIPIENT
                // tenant's locale + timezone (external client -> tenant defaults),
                // not the server default (which anchored UTC with no locale).
                const cfg = await db.select({ defaultLocale: tenantConfigs.defaultLocale, defaultTimezone: tenantConfigs.defaultTimezone })
                    .from(tenantConfigs).where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();
                vars.event_scheduled_at = ev.scheduledAt
                    ? formatDateTime(ev.scheduledAt as Date, {
                          locale: resolveLocale(cfg?.defaultLocale),
                          timeZone: resolveTenantTimeZone(cfg?.defaultTimezone),
                      })
                    : '';
            }
        } catch (err) {
            logger.error('Failed to load event vars for automation log', { logId: log.id, eventId: log.eventId }, err instanceof Error ? err : undefined);
        }
    }

    // Lazy: only create agreement_request when this rule actually needs it
    const needsAgreementUrl = bodySource.includes('{{agreement_sign_url}}') ||
                              subjectSource.includes('{{agreement_sign_url}}');
    if (needsAgreementUrl) {
        if (!deps.agreementService) {
            await db.update(automationLogs).set({ status: 'failed', error: 'AgreementService not configured' })
                .where(eq(automationLogs.id, log.id));
            return;
        }
        try {
            const ar = await deps.agreementService.findOrCreate(inspection.tenantId, inspection.id);
            vars.agreement_sign_url = `${appBaseUrl}/sign-agreement/${ar.token}`;
        } catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Failed to create agreement_request';
            await db.update(automationLogs).set({ status: 'failed', error: errMsg.slice(0, 500) })
                .where(eq(automationLogs.id, log.id));
            return;
        }
    }

    const needsReviewUrl = bodySource.includes('{{review_url}}') ||
                           subjectSource.includes('{{review_url}}');
    if (needsReviewUrl) {
        const cfg = await db.select({ reviewUrl: tenantConfigs.reviewUrl }).from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, inspection.tenantId)).get();
        if (!cfg?.reviewUrl) {
            await db.update(automationLogs).set({ status: 'skipped', error: 'review_url not configured' })
                .where(eq(automationLogs.id, log.id));
            return;
        }
        vars.review_url = cfg.reviewUrl;
    }

    // Build the OI adapters for this log and delegate the
    // email send + log write to the shared automation core.
    // SP2: the subject/body come from the referenced message_template
    // (resolved above into subjectSource/bodySource), so the inline
    // TemplateStore returns those resolved strings. requiredVars
    // carries the fail-closed review_url value resolved above
    // (undefined → core skips with "review_url not configured",
    //  byte-identical to the former hardcoded guard).

    const templateStore = {
        resolve: async () => ({
            channel: 'email' as const,
            subject: subjectSource,
            body: bodySource,
            variables: tpl.variables,
        }),
    };
    const transport = {
        sendEmail: async (a: { to: string; subject: string; html: string }) => {
            // The rules layer names what it is sending, like every other
            // dispatch path. A tenant-written rule has no code-owned identity
            // and resolves to undefined — unclassified, so it still goes out,
            // it just cannot be muted by a recipient.
            // Conditional spread, not `classId: maybeUndefined` —
            // exactOptionalPropertyTypes distinguishes "absent" from "present
            // and undefined", and absent is what an unclassified send means.
            const classId = automationClassId(automation);
            const { delivered } = await emailSvc.sendEmail(
                [a.to], a.subject, a.html, undefined, classId ? { classId } : {},
            );
            // OI maps "not delivered" (e.g. email not configured) to a
            // SKIPPED log, not a failure. Encode that as a sentinel the
            // logger adapter below translates.
            return delivered
                ? { ok: true as const }
                : { ok: false as const, error: '__email_not_configured__' };
        },
        sendSms: async () => ({ ok: false as const, error: 'sms not routed here' }),
    };
    const loggerAdapter = {
        record: async (row: { logId: string; status: 'sent' | 'failed' | 'skipped'; error?: string; deliveredAtMs?: number }) => {
            // Translate the email-not-configured sentinel back to OI's
            // historical "skipped / email not configured" outcome.
            if (row.status === 'failed' && row.error === '__email_not_configured__') {
                await db.update(automationLogs).set({ status: 'skipped', error: 'email not configured' })
                    .where(eq(automationLogs.id, log.id));
                return;
            }
            if (row.status === 'sent') {
                await db.update(automationLogs).set({
                    status: 'sent',
                    deliveredAt: new Date(row.deliveredAtMs ?? Date.now()),
                }).where(eq(automationLogs.id, log.id));
                return;
            }
            await db.update(automationLogs).set({ status: row.status, ...(row.error !== undefined ? { error: row.error } : {}) })
                .where(eq(automationLogs.id, log.id));
        },
    };

    await deliverAction({
        tenantId: inspection.tenantId,
        logId: log.id,
        to: log.recipient,
        // The core only uses templateId to call the store above,
        // which has already resolved; `log.id` is a stable
        // stand-in when there is no rule to name.
        action: { channel: 'email', templateId: automation?.id ?? log.id },
        vars,
        // Fail-closed vars: review_url was either resolved into `vars`
        // above or the rule didn't reference it. Pass the resolved value
        // (or undefined) so the core's requiredVars reproduces the skip.
        requiredVars: { review_url: vars.review_url },
        deps: { templates: templateStore, transport, logger: loggerAdapter, clock: oiClock },
    });
}
