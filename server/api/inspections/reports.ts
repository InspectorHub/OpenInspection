// The face for the `reports` entity: delete a deliverable, and read/write the
// inspector's report-level narrative.
//
// Reading the LIST is not here on purpose: the order page already fetches one
// aggregate payload (`GET /{id}/hub`) and reports are part of what that page
// is, so a second round trip would buy nothing but a second thing to keep in
// sync. The narrative is the exception, and the hub carries `hasNarrative`
// rather than the prose for exactly that reason — a list payload rendered once
// per deliverable must not grow by an unbounded free-text field, so the text
// has its own read for the one surface that edits it.
//
// Adding a report by hand is the exception path named in the design and has no
// endpoint yet — reports are GENERATED from the sold service lines.
//
// AUTH DIFFERS BY VERB, and the split is the point. Delete is owner/manager,
// matching the sibling `services` router rather than the people routes: it
// destroys a document somebody may have spent a day filling in, which is not an
// inspector's call to make alone. The narrative is owner/manager/INSPECTOR,
// matching every other authoring route (`pca-narrative`, `results`,
// `property-facts`): it is the inspecting professional's own prose, carrying
// their professional liability, and a role gate that kept inspectors out would
// mean the person who is liable for the words cannot write them.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { auditFromContext } from '../../lib/audit';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { deleteReport, getReportNarrative, setReportNarrative } from '../../lib/inspection/reports';
import { createApiResponseSchema, SuccessResponseSchema } from '../../lib/validations/shared.schema';
import {
    ReportNarrativePatchSchema,
    ReportNarrativePayloadSchema,
} from '../../lib/validations/report-narrative.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const ReportParam = z.object({
    id: z.string().min(1).describe('Inspection the report belongs to.'),
    reportId: z.string().min(1).describe('reports.id of the deliverable to delete.'),
});

const NarrativeParam = z.object({
    id: z.string().min(1).describe('Inspection the report belongs to.'),
    reportId: z.string().min(1).describe('reports.id of the deliverable whose narrative this is.'),
});

const NarrativeResponse = createApiResponseSchema(ReportNarrativePayloadSchema);

const getNarrativeRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/reports/{reportId}/narrative',
    tags: ['inspections'],
    summary: "Read a report's inspector-authored narrative",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: NarrativeParam },
    responses: {
        200: { content: { 'application/json': { schema: NarrativeResponse } }, description: 'The stored narrative, or null when none has been written' },
        404: { description: 'Report not found on this inspection in this tenant' },
    },
    operationId: 'getInspectionReportNarrative',
    description: "Returns the inspector's own prose about the report as a whole (`reports.inspector_narrative`), or null. This is NOT `report_versions.summary`, which is the amendment reason recorded at each publish and is a different field with a different meaning.",
}, { scopes: ['read'], tier: 'extended' }));

const patchNarrativeRoute = createRoute(withMcpMetadata({
    method: 'patch', path: '/{id}/reports/{reportId}/narrative',
    tags: ['inspections'],
    summary: "Write a report's inspector-authored narrative",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: NarrativeParam,
        body: { content: { 'application/json': { schema: ReportNarrativePatchSchema } } },
    },
    responses: {
        200: { content: { 'application/json': { schema: NarrativeResponse } }, description: 'The narrative as now stored' },
        404: { description: 'Report not found on this inspection in this tenant' },
    },
    operationId: 'patchInspectionReportNarrative',
    description: "Replaces the report-level narrative wholesale; null or blank clears it. Last writer wins, so a retry stores the same text. The narrative carries professional liability: model-assisted drafts must be recorded in ai_content_reviews (artifact_type 'report', artifact_id this reports.id) by the surface that offered them, before the text is saved here.",
}, { scopes: ['write'], tier: 'extended' }));

const inspectionReportRoutes = createApiRouter()
    // DELETE /api/inspections/:id/reports/:reportId
    .openapi(createRoute(withMcpMetadata({
        method: 'delete', path: '/{id}/reports/{reportId}',
        tags: ['inspections'],
        summary: 'Delete one deliverable from an inspection',
        middleware: [requireRole('owner', 'manager')] as const,
        request: { params: ReportParam },
        responses: {
            200: { content: { 'application/json': { schema: SuccessResponseSchema } }, description: 'Report and its document deleted' },
            404: { description: 'Report not found on this inspection in this tenant' },
            409: { description: 'Refused: the report is the primary one, or it has been published' },
        },
        operationId: 'deleteInspectionReport',
        description: 'Permanently deletes one report and everything belonging only to it — its findings document, the collaborative Yjs state, and its version rows. The billing line that produced it is untouched. Refused for the primary report (every order keeps one; without it the order cannot be edited) and for a published report (it has been delivered and its signed versions are what let a client verify what they hold).',
    }, { scopes: ['write'], tier: 'primary' })), async (c) => {
        const tenantId = getTenantId(c);
        const { id, reportId } = c.req.valid('param');
        await deleteReport(getDrizzle(c), tenantId, id, reportId);
        return c.json({ success: true });
    })
    .openapi(getNarrativeRoute, async (c) => {
        const { id, reportId } = c.req.valid('param');
        const inspectorNarrative = await getReportNarrative(getDrizzle(c), getTenantId(c), id, reportId);
        return c.json({ success: true as const, data: { reportId, inspectorNarrative } }, 200);
    })
    .openapi(patchNarrativeRoute, async (c) => {
        const { id, reportId } = c.req.valid('param');
        const { inspectorNarrative } = c.req.valid('json');
        const stored = await setReportNarrative(getDrizzle(c), getTenantId(c), id, reportId, inspectorNarrative);
        // The LENGTH, never the prose. An audit row is read by people who are
        // not the client, and the narrative is findings about a named person's
        // property — logging it would copy that text into a second table with a
        // different retention story. What an auditor needs is that this person
        // rewrote this report's narrative at this time.
        auditFromContext(c, 'inspection.report_narrative.update', 'inspection', {
            entityId: id,
            metadata: { reportId, cleared: stored === null, length: stored?.length ?? 0 },
        });
        return c.json({ success: true as const, data: { reportId, inspectorNarrative: stored } }, 200);
    });

export default inspectionReportRoutes;
