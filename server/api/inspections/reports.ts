// The write face for the `reports` entity — currently one verb, and the only
// irreversible one in per-deliverable delivery.
//
// Reading the list is not here on purpose: the order page already fetches one
// aggregate payload (`GET /{id}/hub`) and reports are part of what that page
// is, so a second round trip would buy nothing but a second thing to keep in
// sync. Adding a report by hand is the exception path named in the design and
// has no endpoint yet — reports are GENERATED from the sold service lines.
//
// Auth is owner/manager, matching the sibling `services` router rather than the
// people routes: this destroys a document somebody may have spent a day filling
// in, which is not an inspector's call to make alone.
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getDrizzle, getTenantId } from '../../lib/route-helpers';
import { deleteReport } from '../../lib/inspection/reports';
import { SuccessResponseSchema } from '../../lib/validations/shared.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

const ReportParam = z.object({
    id: z.string().min(1).describe('Inspection the report belongs to.'),
    reportId: z.string().min(1).describe('reports.id of the deliverable to delete.'),
});

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
    });

export default inspectionReportRoutes;
