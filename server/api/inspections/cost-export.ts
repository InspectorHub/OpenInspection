// Commercial PCA Phase C — cost line export. CSV here (zero-dependency safety
// net); the .xlsx variant is added alongside. Role-gated; tenant-scoped via the
// service (JWT tenantId only — never client input).
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId } from '../../lib/route-helpers';
import { contentDisposition } from '../../lib/content-disposition';
import { CostItemService } from '../../services/cost-item.service';
import { costItemsToCsv } from '../../lib/pca-costs';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

export const costExportCsvRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/cost-export.csv',
    tags: ['inspections'],
    summary: 'Export cost items as CSV',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection identifier') }),
    },
    responses: {
        200: {
            content: { 'text/csv': { schema: z.string().describe('Flat CSV dump of cost items') } },
            description: 'CSV export of cost items',
        },
    },
    operationId: 'exportInspectionCostItemsCsv',
    description: 'Flat CSV export of every commercial PCA cost item recorded for the inspection, including the derived total_cents column, for spreadsheet import or offline review.',
}, { scopes: ['read'], tier: 'extended' }));

const costExportRoutes = createApiRouter()
    .openapi(costExportCsvRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const items = await new CostItemService(c.env.DB).listByInspection(id, tenantId);
        const csv = costItemsToCsv(items);
        return new Response(csv, {
            status: 200,
            headers: {
                'Content-Type': 'text/csv; charset=utf-8',
                'Content-Disposition': contentDisposition(`cost-items-${id}.csv`, true),
            },
        });
    });

export default costExportRoutes;
