/**
 * Design System 0520 subsystem E phase 7 — AnalyticsPanel routes.
 *
 *   GET /api/analytics/growth?months=12     monthly inspection count buckets
 *   GET /api/analytics/findings-heatmap     section × rating bucket counts
 *
 * JWT-guarded; tenant scope from the JWT claim. Both responses are
 * read-only and safe to cache for ~60 seconds at the edge.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { resolveMetricsWindow } from '../lib/metrics-window';

const growthRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/growth',
    tags: ["metrics"],
    summary: 'Inspection count per month for the last N months',
    request: { query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12).describe('TODO describe months field for the OpenInspection MCP integration') }).describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: { 200: { description: 'ok' } },
    operationId: "listAnalyticGrowth",
    description: "Auto-generated placeholder for listAnalyticGrowth (GET /growth, metrics domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const heatmapRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/findings-heatmap',
    tags: ["metrics"],
    summary: 'Section × rating-level counts across this tenant\'s inspections',
    request: { query: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('First day of the window (inclusive), YYYY-MM-DD.'),
        to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Last day of the window (inclusive), YYYY-MM-DD.'),
    }).describe('The same inclusive civil-date window GET /api/metrics takes.') },
    responses: { 200: { description: 'ok' } },
    operationId: "listAnalyticFindingsHeatmap",
    description: "Counts rated items by template section and rating level over an inclusive `from`..`to` window. Columns are the tenant's own rating levels minus Not Inspected / Not Present; rows are template sections ordered by volume, with unresolvable sections collected in a flagged catch-all row."
}, { scopes: ['read'], tier: 'extended' }));

const analyticsRoutes = createApiRouter()
    .openapi(growthRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const { months } = c.req.valid('query');
        const out = await c.var.services.analytics.growth(tenantId, months);
        return c.json({ success: true as const, data: out }, 200);
    })
    .openapi(heatmapRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const window = resolveMetricsWindow(c.req.valid('query'));
        const out = await c.var.services.analytics.findingsHeatmap(tenantId, window);
        return c.json({ success: true as const, data: out }, 200);
    });

export type AnalyticsApi = typeof analyticsRoutes;
export default analyticsRoutes;
