/**
 * "Copy as a new report": POST /api/inspections/:id/copy-report.
 *
 * A new inspection that starts from the findings of an earlier one (repeat clients, a re-inspection
 * that is not a formal round, a report that was imported and is read-only). The service in
 * `services/inspection/inspection-copy-report.service.ts` owns what is carried and what is not.
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { logger } from '../../lib/logger';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole, denyStaff } from '../../lib/middleware/rbac';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { CopyReportBodySchema, CopyReportDataSchema } from '../../lib/validations/copy-report.schema';
import { auditFromContext } from '../../lib/audit';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { moneyView } from '../../lib/auth/money-access';
import { toInspectionRecord } from '../../lib/response-projection';
import { requireVisibleInspection, resolveInspectionScope } from '../../lib/inspection/visibility';
import { PlanQuotaGuard } from '../../features/plan-quota/guard';
import { InspectionCopyReportService } from '../../services/inspection/inspection-copy-report.service';
import { fireQuotaThresholdNotice } from './create-support';

const copyReportRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{id}/copy-report',
    tags: ['inspections'],
    summary: 'Copy an inspection as a new report',
    middleware: [requireRole('owner', 'manager', 'inspector'), denyStaff] as const,
    request: {
        params: z.object({ id: z.string().trim().min(1).describe('Id of the inspection whose findings the new report starts from.') }),
        body: { content: { 'application/json': { schema: CopyReportBodySchema } } },
    },
    responses: {
        201: {
            content: { 'application/json': { schema: createApiResponseSchema(CopyReportDataSchema) } },
            description: 'The new inspection and what was copied',
        },
        400: { description: 'Validation error, for example no address for a copy at a different property' },
        402: { description: 'The plan allowance for new inspections is used up; nothing was written' },
        404: { description: 'No such inspection in this company, or not one the caller can open' },
    },
    operationId: 'copyInspectionAsNewReport',
    description: 'Creates a new inspection whose report starts from the findings of an existing one. The booking and property details, price and requirements come across as they do for a clone; findings are copied per the chosen scope (rating, rating and notes, or everything the allow-list carries) into the places the new inspection\'s template has for them, and findings with no matching place are dropped and counted. Carried verbatim, and so able to name the previous client, a door or lockbox code or the old street: notes, value, attributes, and the comment, title and location of canned and custom defects and comments, and a photo\'s annotationsJson; a defect\'s deadline is the old job\'s absolute date. Without an explicit scope a copy at a different property takes ratings only. Photos are copied only when asked for (never for a different property), as new files under the new report, keeping only their content type; the source\'s files are never shared or changed. Videos are never copied, and photos stored under an older key layout (not directly in the inspection\'s photos folder) are skipped. Photos are copied within a small, conservative per-request storage budget: about six plain photos, or two with two baked variants each (the platform allowance behind this is unmeasured, so the figure is deliberately low). summary.photos reports copied, failed, skipped, unsupported, droppedVariants and deferred, and complete is null when photos were not asked for, false when anything photo-like is missing and true only when nothing is. Nothing continues a partial copy later. summary.people and summary.roster say whether the client/agent links and the lead and helpers came across. If the new inspection cannot be read back, the answer is still 201 with its basic header. Nothing about the source\'s sign-off comes across: no signature, no published version or verification token, no agreement, no payment, no client-portal access, no editing history. The copy is an ordinary editable inspection with status requested, payment unpaid and a draft report. Counts as one new inspection against the plan allowance, consumed before anything is written. Sends nothing to anyone. Not idempotent: each call makes another copy, so send an Idempotency-Key header to make a retry safe. Available to owner, manager and inspector roles (office staff get 403); an inspector restricted to their own inspections must be on the source inspection.',
}, { scopes: ['write'], tier: 'extended' }));

async function readCopy(c: Context<HonoConfig>, id: string, tenantId: string) {
    return (await c.var.services.inspection.getInspection(id, tenantId)).inspection;
}

const app = createApiRouter();
app.openapi(copyReportRoute, async (c) => {
    const tenantId = getTenantId(c);
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');

    // An inspection outside the caller's visible set answers like one that does not exist.
    await requireVisibleInspection(getDrizzle(c), await resolveInspectionScope(c), tenantId, id);

    const planQuota = c.var.profile.hasUsageQuota
        ? new PlanQuotaGuard(c.env.DB, { enforced: true, billingPortalUrl: c.var.profile.billingPortalUrl })
        : undefined;
    const { inspection: created, summary } = await new InspectionCopyReportService(c.env.DB, c.env.PHOTOS, planQuota)
        .copyReport(tenantId, id, body);

    // Ids, scope and counts only: never note text, file names or an address.
    auditFromContext(c, 'inspection.copy_report', 'inspection', {
        entityId: created.id,
        metadata: {
            sourceId: id,
            scope: body.scope,
            samePropertyCopied: body.property === 'same',
            photosRequested: body.photos,
            findingsCopied: summary.findings.copied,
            findingsDropped: summary.findings.dropped,
            photosCopied: summary.photos.copied,
            photosFailed: summary.photos.failed,
        },
    });
    // The ordinary creation record for the new inspection, without its address.
    auditFromContext(c, 'inspection.create', 'inspection', { entityId: created.id, metadata: { clonedFrom: id } });
    fireQuotaThresholdNotice(c, tenantId);

    // The same read the booking clone answers with, so the client name and email resolve from the people links. The copy exists and
    // its place is counted by now, so a failed read still answers 201 with the header it was created with rather than a 500 that
    // would invite a second copy.
    let inspection: Awaited<ReturnType<typeof readCopy>>;
    try {
        inspection = await readCopy(c, created.id, tenantId);
    } catch (err) {
        logger.error('copy-report.read-back.failed', { inspectionId: created.id }, err instanceof Error ? err : undefined);
        inspection = {
            id: created.id, propertyAddress: created.propertyAddress, clientName: null, clientEmail: null, status: created.status,
            date: created.date, inspectorId: created.inspectorId ?? null, templateId: created.templateId ?? null, createdAt: created.createdAt.toISOString(),
        };
    }

    return c.json({ success: true as const, data: { inspection: await moneyView(c, toInspectionRecord(inspection), 'inspectionFees'), summary } }, 201);
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const copyReportRouteConfigs = [copyReportRoute] as const;

export default app;
