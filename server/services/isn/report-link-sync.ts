/**
 * The push: a published report's link onto the ISN order it belongs to.
 *
 * Which order: the inspection's Reference Number, holding the ISN order number
 * the office already sees (or the order's uuid). Resolving it through ISN first
 * means a mistyped number fails loudly instead of landing on someone else's job.
 *
 * Gates: this touches none. The link is this app's own report link, so this
 * app's agreement/payment/release gates apply to it exactly as they do to any
 * other link it issues.
 *
 * The publish route imports this lazily: most deployments never configure ISN,
 * and that route's startup closure should not grow for them.
 */
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../../types/hono';
import { inspections, reports } from '../../lib/db/schema';
import { getDrizzle } from '../../lib/route-helpers';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { reportUrl } from '../../lib/public-urls';
import { resolvePublishTargetReport } from '../../lib/inspection/report-notifications';
import { logger } from '../../lib/logger';
import { isnCall, isnConfig, type IsnConfig } from './api-base';
import { buildReportLinkParams } from './report-link-payload';

/**
 * Adds `url` to ISN order `orderRef` and reads it back. Returns ISN's id for
 * the new report row. A write that cannot be read back is a failure; a deleted
 * row stays in `/orderfiles` with `show: false`, so presence alone is not enough.
 */
export async function addReportLinkToIsnOrder(cfg: IsnConfig, orderRef: string, url: string, title: string): Promise<string> {
    const order = (await isnCall(cfg, 'GET', `/order/${encodeURIComponent(orderRef)}`)).order as { id?: unknown } | undefined;
    if (typeof order?.id !== 'string') throw new Error(`ISN returned no order for "${orderRef}"`);
    const added = await isnCall(cfg, 'PUT', '/orders/addreporturl', buildReportLinkParams({ orderId: order.id, url, title }));
    const rowId = typeof added.id === 'string' ? added.id : '';
    // ponytail: /orderfiles lists every order's files; pass start/end if a company's list gets large.
    const files = (await isnCall(cfg, 'GET', '/orderfiles')).files;
    const landed = Array.isArray(files) && files.some((f: { id?: unknown; show?: unknown }) => f.id === rowId && f.show !== false);
    if (!rowId || !landed) throw new Error(`ISN accepted the report link but it is not on order ${orderRef}`);
    return rowId;
}

export type IsnSyncResult = { ok: true; isnReportId: string } | { ok: false; error: string };

/**
 * Publish-time glue. Null = not an ISN order (no credentials, or no Reference
 * Number). Never throws: the publish has already happened, and a report that
 * did not reach ISN is still published.
 */
export async function syncPublishedReportToIsn(
    c: Context<HonoConfig>, tenantId: string, inspectionId: string, reportId?: string,
): Promise<IsnSyncResult | null> {
    const cfg = isnConfig(c.env);
    if (!cfg) return null;
    const db = getDrizzle(c);
    const insp = await db.select({ ref: inspections.referenceNumber }).from(inspections)
        .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId))).get();
    const orderRef = insp?.ref?.trim();
    if (!orderRef) return null;

    try {
        // Our missing data is named before any round trip.
        const client = await c.var.services.people.getPrimaryClient(tenantId, inspectionId);
        if (!client?.email) throw new Error('Cannot send to ISN: the inspection has no client email to issue a report link for');
        // One link for the order, carried by the primary client's portal token.
        // issueToken is idempotent, so a republish sends the same link again.
        const token = await c.var.services.portalAccess.issueToken({ tenantId, inspectionId, recipientEmail: client.email, role: 'client' });
        const url = `${reportUrl(getBookingHost(c), await resolveTenantSlug(c, tenantId), inspectionId)}?token=${encodeURIComponent(token)}`;
        const targetId = await resolvePublishTargetReport(db, tenantId, inspectionId, reportId);
        const report = targetId
            ? await db.select({ title: reports.title }).from(reports)
                  .where(and(eq(reports.id, targetId), eq(reports.tenantId, tenantId))).get()
            : undefined;

        const isnReportId = await addReportLinkToIsnOrder(cfg, orderRef, url, report?.title || 'Inspection Report');
        logger.info('report link added to ISN order', { inspectionId, orderRef, isnReportId });
        return { ok: true, isnReportId };
    } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        logger.error('ISN report sync failed', { inspectionId, orderRef, error });
        return { ok: false, error };
    }
}
