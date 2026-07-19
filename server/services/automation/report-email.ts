import { eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { automationLogs, type tenants } from '../../lib/db/schema';
import { buildPortalUrl } from '../../lib/portal-urls';
import { buildRenderReportUrl } from '../../lib/public-urls';
import { logger } from '../../lib/logger';
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
 */
export async function deliverReportEmail(
    db: DrizzleD1Database,
    ctx: {
        log: typeof automationLogs.$inferSelect;
        inspection: FlushInspection;
        tenant: typeof tenants.$inferSelect;
    },
    emailSvc: EmailService,
    appBaseUrl: string,
    reportDelivery: ReportDeliveryDeps,
    pdfMemo: Map<string, Promise<ArrayBuffer | null>>,
): Promise<void> {
    const { log, inspection, tenant } = ctx;
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

        let delivered: boolean;
        try {
            delivered = pdf
                ? await emailSvc.sendInspectionReportPdf(log.recipient, address, linkUrl, pdf, undefined, reportDelivery.renderHost)
                : await emailSvc.sendReportReady(log.recipient, address, linkUrl, undefined, reportDelivery.renderHost);
        } catch (err) {
            logger.error('AutomationService.flush: report PDF email send failed; falling back to text-only email',
                { inspectionId: inspection.id, logId: log.id }, err instanceof Error ? err : undefined);
            delivered = await emailSvc.sendReportReady(log.recipient, address, linkUrl, undefined, reportDelivery.renderHost);
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
        await db.update(automationLogs)
            .set({ status: 'failed', error: err instanceof Error ? err.message.slice(0, 500) : 'Unknown error' })
            .where(eq(automationLogs.id, log.id));
        logger.error('AutomationService.flush: report email delivery failed', { logId: log.id },
            err instanceof Error ? err : undefined);
    }
}
