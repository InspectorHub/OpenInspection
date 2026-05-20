/**
 * Design System 0520 subsystem E phase 6 — IntegrationsService route.
 *
 * `GET /api/integrations/status` returns the six-row snapshot the
 * grid page renders. JWT-guarded; tenant scope from the JWT claim.
 */
import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { Errors } from '../lib/errors';
import type { HonoConfig } from '../types/hono';

const integrationsRoutes = new OpenAPIHono<HonoConfig>();

const statusRoute = createRoute({
    method:  'get',
    path:    '/status',
    tags:    ['Integrations'],
    summary: 'Snapshot of every integration for the active tenant',
    responses: { 200: { description: 'ok' } },
});
integrationsRoutes.openapi(statusRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
    const out = await c.var.services.integrations.status(tenantId);
    return c.json({ success: true as const, data: out }, 200);
});

export default integrationsRoutes;
