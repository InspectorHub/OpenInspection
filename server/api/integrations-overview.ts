/**
 * GET /api/integrations/overview: every outside service as one card, with its
 * status and whose account it runs on. Owner and manager only; the company is
 * the one on the verified session, never one named in the request.
 *
 * Mounted under the integrations router (see `integrations.ts`) so the typed
 * client reaches it as `api.integrations.overview`.
 */
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { requireRole } from '../lib/middleware/rbac';
import { IntegrationOverviewResponseSchema } from '../lib/validations/integrations-overview.schema';
import { buildIntegrationOverview } from '../lib/integrations/overview';
import { loadOverviewInputs } from '../lib/integrations/overview-data';

const overviewRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ['integrations'],
    summary: 'Overview of every outside service and its source',
    middleware: [requireRole('owner', 'manager')],
    responses: {
        200: { content: { 'application/json': { schema: IntegrationOverviewResponseSchema } }, description: 'One card per service' },
    },
    operationId: 'getIntegrationOverview',
    description: 'Returns one card per outside service (card payments, accounting, calendar, email, SMS, address suggestions, property facts, video, AI) with its status (connected, needs attention, not connected), its source (built-in or the company\'s own account) and whether the company can switch between the two. Derived from stored settings and keys with no network call. Keys are never returned, only whether they are set.',
}, { scopes: ['admin'], tier: 'extended' }));

const integrationsOverviewRoutes = createApiRouter()
    .openapi(overviewRoute, async (c) => {
        const tenantId = c.get('tenantId');
        if (!tenantId) throw Errors.Unauthorized('Missing tenant scope');
        const inputs = await loadOverviewInputs({
            env: c.env,
            profile: c.var.profile,
            tenantId,
            userId: c.get('user')?.sub ?? null,
            tenantSecretKeys: c.get('tenantSecretKeys') ?? [],
        });
        return c.json({ success: true as const, data: buildIntegrationOverview(inputs) }, 200);
    });

export default integrationsOverviewRoutes;
