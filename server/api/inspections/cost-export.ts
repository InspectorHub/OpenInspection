// Commercial PCA Phase C — cost line export. CSV (zero-dependency safety net)
// + a multi-sheet .xlsx variant. Role-gated; tenant-scoped via the service
// (JWT tenantId only — never client input). The .xlsx handler re-reads the
// same tenant_configs reserve fields + inspection.sqft that getReportData
// uses, so the exported Reserve Schedule sheet never diverges from the
// rendered report (reconciliation invariant).
import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getTenantId, getDrizzle } from '../../lib/route-helpers';
import { contentDisposition } from '../../lib/content-disposition';
import { CostItemService } from '../../services/cost-item.service';
import { costItemsToCsv, buildCostTables } from '../../lib/pca-costs';
import { costTablesToXlsxBuffer } from '../../lib/pca-costs-xlsx';
import { tenantConfigs, inspections } from '../../lib/db/schema';
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

export const costExportXlsxRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{id}/cost-export.xlsx',
    tags: ['inspections'],
    summary: 'Export cost items as XLSX',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ id: z.string().describe('Inspection identifier') }),
    },
    responses: {
        200: {
            content: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { schema: z.string().describe('XLSX workbook') } },
            description: 'XLSX export of cost tables',
        },
    },
    operationId: 'exportInspectionCostItemsXlsx',
    description: 'Multi-sheet XLSX export of the commercial PCA cost tables (Opinion of Cost +, when enabled, the Reserve Schedule), reconciled against the same tenant reserve configuration the rendered report uses.',
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
    })
    .openapi(costExportXlsxRoute, async (c) => {
        const tenantId = getTenantId(c);
        const { id } = c.req.valid('param');
        const items = await new CostItemService(c.env.DB).listByInspection(id, tenantId);

        // Reserve config + building area — mirror InspectionReportService.getReportData's
        // reserve-config read exactly, so the exported Reserve Schedule sheet never
        // diverges from the rendered report (reconciliation invariant).
        const db = getDrizzle(c);
        const cfg = await db.select({
            reserveScheduleEnabled: tenantConfigs.reserveScheduleEnabled,
            reserveTermYears: tenantConfigs.reserveTermYears,
            inflationRateBps: tenantConfigs.inflationRateBps,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const insp = await db.select({ sqft: inspections.sqft })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();

        const tables = buildCostTables(
            items,
            {
                reserveScheduleEnabled: Boolean(cfg?.reserveScheduleEnabled),
                reserveTermYears: cfg?.reserveTermYears ?? 12,
                inflationRateBps: cfg?.inflationRateBps ?? null,
            },
            new Date().getFullYear(),
            insp?.sqft ?? null,
        );
        const buffer = await costTablesToXlsxBuffer(tables);
        return new Response(buffer, {
            status: 200,
            headers: {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': contentDisposition(`cost-items-${id}.xlsx`, true),
            },
        });
    });

export default costExportRoutes;
