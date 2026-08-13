import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { automationLogs, type automations, type tenants } from '../../lib/db/schema';
import { buildPortalUrl } from '../../lib/portal-urls';
import { buildRenderReportUrl } from '../../lib/public-urls';
import { logger } from '../../lib/logger';
import { interpolate, isStaffRecipient } from './shared';
import { buildBaseTemplateVars } from './template-vars';
import { createOiTemplateStore } from './template-store';
import { createRecipientLocaleResolver } from '../../lib/i18n/recipient-locale';
import { automationClassId } from '../../lib/notifications/automation-classes';
import { coolingWindowUnlockAtMs, deferUntilCoolingWindowOpens } from './cooling-window';
import { reportDeliverySystemBlocks } from '../../lib/email-templates/renderer';
import type { FlushInspection } from './shared';
import type { EmailService } from '../email.service';
import type { PortalAccessService } from '../portal-access.service';
import type { ReportPdfService } from '../report-pdf.service';

/**
 * Narrow, purpose-built deps for delivering `report.published` EMAIL logs as a
 * per-recipient tokenized portal link + PDF attachment inside flush() —
 * mirrors the `ManagedSendGateEnv` precedent (never the whole worker Env).
 * Optional on `flush()`; when absent, `report.published` email logs fall
 * through unchanged to the generic template path (backward-compatible opt-in
 * seam — see delivery.ts). Wired for real in server/scheduled.ts (the only
 * caller with the full worker env).
 */
export interface ReportDeliveryDeps {
    portalAccess: PortalAccessService;
    reportPdf: ReportPdfService;
    /** Resolve the render-cache content hash for an inspection (wraps InspectionService.getReportContentHash). */
    getContentHash: (inspectionId: string, tenantId: string) => Promise<string>;
    /** Bare host (no protocol) for the render URL — the cron path's appHost. */
    renderHost: string;
    /** JWT_SECRET used to sign the short-TTL render token (buildRenderReportUrl). */
    renderSecret: string;
}

/**
 * What the rule's OWN copy needs, on top of the link + PDF above.
 *
 * Separate from ReportDeliveryDeps on purpose: those five are the cron-only
 * seam that decides whether this path runs at all, and these are what every
 * templated automation email has always needed (a raw D1 handle for the
 * message_template store, and the two strings the shared vars are built from).
 * flush() has all three in scope; scheduled.ts should not have to know about
 * template resolution to wire a PDF renderer.
 */
export interface ReportCopyDeps {
    /** Raw D1 handle — the message-template store builds its own drizzle instance. */
    rawDb: D1Database;
    appName: string;
    appHost: string;
}

/**
 * Deliver a single `report.published` EMAIL log as a per-recipient tokenized
 * portal link + the report PDF. Mirrors the inline `completeInspection` send
 * in server/api/inspections/publish.ts (issueToken -> buildPortalUrl ->
 * buildRenderReportUrl -> reportPdf.getOrRender -> streamPdf ->
 * sendInspectionReportPdf, with sendReportReady text fallback) but
 * per-recipient and cron-driven.
 *
 * The PDF is rendered ONCE per inspection: `pdfMemo` is a flush()-call-scoped
 * map the caller declares once before its loop and passes into every call for
 * the same batch, so an `all`-recipient rule with N logs for one inspection
 * triggers exactly one `getOrRender`.
 *
 * Never throws — always marks the log row itself (mirrors the existing
 * post-deliverAction bookkeeping in flush(): `status:'sent'` + `deliveredAt`
 * when the underlying send actually dispatched, `status:'skipped'` + `error`
 * when nothing was sent without an exception (report-ready template disabled
 * for the tenant, or email not configured — sendReportReady/sendInspectionReportPdf
 * return `false` in that case), `status:'failed'` + `error` on any thrown
 * exception), so the caller can simply `continue` after awaiting this.
 *
 * Simplification vs publish.ts: the cron path doesn't resolve a signature
 * inspector (that lookup lives in the request-scoped publish flow and isn't
 * worth threading through the batch cron path just for the footer signature)
 * — the report email still sends correctly without it, just without the
 * inspector signature footer.
 *
 * WHOSE WORDS GO OUT. The rule's `email_template_id` decides, exactly as it
 * does on the generic path (deliver-email.ts). This branch used to ignore it
 * and render the `report-ready` catalogue default for every rule, which broke
 * two things at once, both of them per-ROLE:
 *
 *  1. Copy. `report.published` carries five distinct seeds — Report Ready, the
 *     buyer's-agent and listing-agent variants, the post-inspection follow-up,
 *     the review request — each with its own subject and body, and each
 *     targeted at a different role. Rendering one catalogue template for all
 *     five delivered them as the same email. A client who is also the buyer's
 *     agent on an order therefore received the identical message twice, and the
 *     follow-up a day later was indistinguishable from the delivery it was
 *     following up on.
 *  2. The recipient's kill switch. `automationClassId` exists because those
 *     five seeds do NOT agree on whether they may be switched off (spec §5.3:
 *     report-ready is required, the follow-up and review request are not).
 *     Sending them all through `sendReportReady` stamped every one of them
 *     `report-ready` — a required class the preference gate fails closed on —
 *     so muting the follow-up had no effect on what arrived.
 *
 * A rule with no resolvable email template still falls back to the catalogue
 * default below: a stale template reference must not be the reason a published
 * report goes undelivered.
 */
export async function deliverReportEmail(
    db: DrizzleD1Database,
    ctx: {
        log: typeof automationLogs.$inferSelect;
        /** The rule this log belongs to; null for a ruleless (manual) row. */
        automation: typeof automations.$inferSelect | null;
        inspection: FlushInspection;
        tenant: typeof tenants.$inferSelect;
    },
    emailSvc: EmailService,
    appBaseUrl: string,
    reportDelivery: ReportDeliveryDeps,
    pdfMemo: Map<string, Promise<ArrayBuffer | null>>,
    copyDeps: ReportCopyDeps,
): Promise<void> {
    const { log, automation, inspection, tenant } = ctx;
    try {
        // role-keyed token: role is a role-profile KEY (e.g. 'buyer_agent');
        // 'client' is the fallback for logs with no role context.
        const role = log.recipientRoleKey ?? 'client';
        const token = await reportDelivery.portalAccess.issueToken({
            tenantId: inspection.tenantId,
            inspectionId: inspection.id,
            recipientEmail: log.recipient,
            role,
        });
        const linkUrl = buildPortalUrl(appBaseUrl, tenant.slug, inspection.id, token);
        const address = inspection.propertyAddress ?? '';

        // Render-once-per-inspection memo: reused across every recipient log
        // in this flush() batch (an `all`-recipient rule fans out to N logs).
        let pdfPromise = pdfMemo.get(inspection.id);
        if (!pdfPromise) {
            pdfPromise = (async () => {
                try {
                    const renderUrl = await buildRenderReportUrl(
                        reportDelivery.renderHost, tenant.slug, inspection.id, reportDelivery.renderSecret,
                    );
                    const contentHash = await reportDelivery.getContentHash(inspection.id, inspection.tenantId);
                    const record = await reportDelivery.reportPdf.getOrRender(
                        inspection.id, inspection.tenantId, 'full',
                        { reportUrl: renderUrl, contentHash, versionNumber: null },
                    );
                    const obj = await reportDelivery.reportPdf.streamPdf(record);
                    if (!obj) return null;
                    return await obj.arrayBuffer();
                } catch (err) {
                    logger.error('AutomationService.flush: report PDF render failed; falling back to text-only email',
                        { inspectionId: inspection.id }, err instanceof Error ? err : undefined);
                    return null;
                }
            })();
            pdfMemo.set(inspection.id, pdfPromise);
        }
        const pdf = await pdfPromise;

        // The rule's own copy, in the RECIPIENT's language. Resolved at send
        // time rather than stamped at enqueue for the same reason the generic
        // path does it: a delayed rule can sit for a day, and the language
        // someone reads is a current fact about them (see deliver-email.ts).
        const ruleCopy = await resolveRuleCopy(db, automation, log, inspection.tenantId, copyDeps.rawDb);

        let delivered: boolean;
        if (ruleCopy) {
            const vars = {
                ...buildBaseTemplateVars(inspection, tenant, copyDeps.appName, copyDeps.appHost),
                // The tokenized, per-recipient link — NOT the bare report URL
                // buildBaseTemplateVars derives. A recipient with no login gets
                // "Report not found" from the bare one, which is the whole
                // reason this delivery path exists.
                report_url: linkUrl,
            };
            // The system blocks ride BELOW the tenant's words, not inside them:
            // the Art. 13 notice (OI #271, LIA conditions 4/5) has to survive a
            // tenant who empties the template, which it can only do if nothing
            // tenant-editable can reach it.
            const html = interpolate(ruleCopy.body, vars)
                + reportDeliverySystemBlocks({ reportUrl: linkUrl, hasAttachment: !!pdf });
            const attachments = pdf
                ? [{ filename: `${address.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60)}-report.pdf`, content: pdf }]
                : undefined;
            // Conditional spread, not `classId: maybeUndefined` —
            // exactOptionalPropertyTypes distinguishes "absent" from "present
            // and undefined", and absent is what a tenant-written rule means
            // (unclassified, therefore unmutable). Same posture as
            // deliver-email.ts's transport adapter.
            const classId = automationClassId(automation);
            ({ delivered } = await emailSvc.sendEmail(
                [log.recipient],
                interpolate(ruleCopy.subject, vars),
                html,
                attachments,
                classId ? { classId } : {},
            ));
        } else {
            try {
                delivered = pdf
                    ? await emailSvc.sendInspectionReportPdf(log.recipient, address, linkUrl, pdf, undefined, reportDelivery.renderHost)
                    : await emailSvc.sendReportReady(log.recipient, address, linkUrl, undefined, reportDelivery.renderHost);
            } catch (err) {
                // A REFUSAL is not a render problem, so dropping the attachment
                // and trying again cannot help: the gate runs before the
                // provider request is built, so the retry raises the identical
                // error, logs a second scary line about a PDF that was fine,
                // and arrives at the same outer catch. Hand it straight up.
                if (coolingWindowUnlockAtMs(err) !== null) throw err;
                logger.error('AutomationService.flush: report PDF email send failed; falling back to text-only email',
                    { inspectionId: inspection.id, logId: log.id }, err instanceof Error ? err : undefined);
                delivered = await emailSvc.sendReportReady(log.recipient, address, linkUrl, undefined, reportDelivery.renderHost);
            }
        }

        // `delivered === false` means nothing was sent without an exception —
        // the tenant disabled the report-ready template, or email isn't
        // configured (sendEmail's own soft-skip). That's not a failure to
        // retry (the log would never leave `pending` and clutter the due-query
        // forever); mirror the generic template path's "skipped" terminal
        // status (see delivery.ts's `__email_not_configured__` translation).
        if (delivered) {
            await db.update(automationLogs)
                .set({ status: 'sent', deliveredAt: new Date() })
                .where(eq(automationLogs.id, log.id));
        } else {
            await db.update(automationLogs)
                .set({ status: 'skipped', error: 'report email not sent (template disabled or email not configured)' })
                .where(eq(automationLogs.id, log.id));
        }
    } catch (err) {
        // The cooling window DECLINED; it did not break, and it says when it
        // stops. Recognised HERE rather than inside the two send branches
        // because every one of them can raise it — the gate runs before the
        // provider request is even built (EmailBaseService.performSend) — and
        // one exit for it is what keeps the log from spending a terminal
        // status on a clock. See ./cooling-window.
        const unlockAtMs = coolingWindowUnlockAtMs(err);
        if (unlockAtMs !== null) {
            await deferUntilCoolingWindowOpens(db, log.id, unlockAtMs);
            return;
        }
        await db.update(automationLogs)
            .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error' })
            .where(eq(automationLogs.id, log.id));
        logger.error('AutomationService.flush: report email delivery failed', { logId: log.id },
            err instanceof Error ? err : undefined);
    }
}

/**
 * The copy this rule sends, or null for "use the catalogue default".
 *
 * Null for every unhappy case — no rule, no template referenced, the template
 * was deleted, it turns out to be an SMS template, or it has no subject line —
 * because none of those is a reason to withhold a published report. That is the
 * same six-way posture `resolveRoleEmailTemplate` takes for the manual send,
 * and it differs deliberately from the GENERIC path, which fails closed with
 * "no email template": there, a missing template means there is nothing at all
 * to say; here, there is still a report to deliver and default wording to
 * deliver it in.
 *
 * A missing subject counts as no template rather than sending mail with an
 * empty subject line, which reads as spam and is worse than the default.
 */
async function resolveRuleCopy(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    automation: typeof automations.$inferSelect | null,
    log: typeof automationLogs.$inferSelect,
    tenantId: string,
    rawDb: D1Database,
): Promise<{ subject: string; body: string } | null> {
    if (!automation?.emailTemplateId) return null;
    try {
        const locale = await createRecipientLocaleResolver(db, tenantId)(
            log.recipientContactId
                ? { kind: isStaffRecipient(log.recipientRoleKey) ? 'user' : 'contact', id: log.recipientContactId }
                : null,
        );
        const tpl = await createOiTemplateStore(rawDb).resolve(tenantId, automation.emailTemplateId, locale);
        if (!tpl || tpl.channel !== 'email' || !tpl.subject?.trim()) return null;
        return { subject: tpl.subject, body: tpl.body };
    } catch (err) {
        logger.warn('AutomationService.flush: rule email template lookup failed; using default report copy', {
            logId: log.id, automationId: automation.id,
            error: err instanceof Error ? err.message : String(err),
        });
        return null;
    }
}
