/**
 * Design System 0520 subsystem E phase 7 — AnalyticsPanel routes.
 *
 *   GET /api/analytics/growth?months=12     monthly inspection count buckets
 *   GET /api/analytics/findings-heatmap     section × rating bucket counts
 *
 * JWT-guarded; tenant scope from the JWT claim. Both responses are
 * read-only and safe to cache for ~60 seconds at the edge.
 */
import { requireRole } from '../lib/middleware/rbac';
import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import type { ApiOf } from '../lib/api-schema';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from "../lib/route-metadata-standards";
import { resolveMetricsWindow } from '../lib/metrics-window';
import { resolveInspectionScope } from '../lib/inspection/visibility';

const growthRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/growth',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    tags: ["metrics"],
    summary: 'Inspection count per month for the last N months',
    request: { query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12).describe('How many calendar months to return, counting back from and including the current month.') }) },
    responses: { 200: { description: 'ok' } },
    operationId: "listAnalyticGrowth",
    description: "Returns the number of inspections created in each of the last N calendar months (UTC), oldest first, as {ym, count} buckets. The current month is the last bucket and months with no inspections appear with a count of 0. Counts every inspection of the company by creation time, with no status or archive filter. Read-only. Available to owner, manager and inspector roles. A caller whose access is limited to the inspections assigned to them receives only what is tied to those inspections."
}, { scopes: ['read'], tier: 'extended' }));

const heatmapRoute = createRoute(withMcpMetadata({
    method:  'get',
    path:    '/findings-heatmap',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    tags: ["metrics"],
    summary: 'Section × rating-level counts across this tenant\'s inspections',
    request: { query: z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('First day of the window (inclusive), YYYY-MM-DD.'),
        to:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('Last day of the window (inclusive), YYYY-MM-DD.'),
    }).describe('The same inclusive civil-date window GET /api/metrics takes.') },
    responses: { 200: { description: 'ok' } },
    operationId: "listAnalyticFindingsHeatmap",
    description: "Counts rated items by template section and rating level over an inclusive `from`..`to` window. Columns are the tenant's own rating levels minus Not Inspected / Not Present; rows are template sections ordered by volume, with unresolvable sections collected in a flagged catch-all row. Available to owner, manager and inspector roles. A caller whose access is limited to the inspections assigned to them receives only what is tied to those inspections."
}, { scopes: ['read'], tier: 'extended' }));

const app = createApiRouter();
app.openapi(growthRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const { months } = c.req.valid('query');
    const out = await c.var.services.analytics.growth(tenantId, months, await resolveInspectionScope(c));
    return c.json({ success: true as const, data: out }, 200);
});
app.openapi(heatmapRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const window = resolveMetricsWindow(c.req.valid('query'));
    const out = await c.var.services.analytics.findingsHeatmap(tenantId, await resolveInspectionScope(c), window);
    return c.json({ success: true as const, data: out }, 200);
});

/** Registration order. Drives `AnalyticsApi`; a test pins it to what `app` really registered. */
export const analyticsRouteConfigs = [
    growthRoute,
    heatmapRoute,
] as const;

export type AnalyticsApi = ApiOf<typeof analyticsRouteConfigs>;
export default app;
