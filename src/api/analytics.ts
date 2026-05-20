/**
 * Design System 0520 subsystem E phase 7 — AnalyticsPanel routes.
 *
 *   GET /api/analytics/growth?months=12     monthly inspection count buckets
 *   GET /api/analytics/findings-heatmap     section × rating bucket counts
 *
 * JWT-guarded; tenant scope from the JWT claim. Both responses are
 * read-only and safe to cache for ~60 seconds at the edge.
 */
import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import { Errors } from '../lib/errors';
import type { HonoConfig } from '../types/hono';

const analyticsRoutes = new OpenAPIHono<HonoConfig>();

const growthRoute = createRoute({
    method:  'get',
    path:    '/growth',
    tags:    ['Analytics'],
    summary: 'Inspection count per month for the last N months',
    request: { query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }) },
    responses: { 200: { description: 'ok' } },
});
analyticsRoutes.openapi(growthRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const { months } = c.req.valid('query');
    const out = await c.var.services.analytics.growth(tenantId, months);
    return c.json({ success: true as const, data: out }, 200);
});

const heatmapRoute = createRoute({
    method:  'get',
    path:    '/findings-heatmap',
    tags:    ['Analytics'],
    summary: 'Section × rating bucket counts across this tenant\'s inspections',
    responses: { 200: { description: 'ok' } },
});
analyticsRoutes.openapi(heatmapRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const out = await c.var.services.analytics.findingsHeatmap(tenantId);
    return c.json({ success: true as const, data: out }, 200);
});

export default analyticsRoutes;
