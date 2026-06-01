import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { ReportDataResponseSchema } from '../lib/validations/inspection.schema';
import { resolvePortalAccess } from '../lib/public-access';

/**
 * Public, no-login portal endpoints (`/api/public/*`). Access is gated by the
 * persistent per-(recipient, order) portal token (Spectora/ISN tokenized-link
 * model). The token is the credential; tenantId is resolved from it, NEVER from
 * the URL `:tenant` segment. See plan 2026-06-01-core-public-endpoints-c10-residual.
 */

const reportRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}',
    tags: ['public'],
    summary: 'Public token-gated inspection report data',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant subdomain (display only; tenant is resolved from the token).'),
            id: z.string().describe('Inspection id.'),
        }),
        query: z.object({ token: z.string().optional().describe('Persistent portal access token.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ReportDataResponseSchema) } }, description: 'Report data' },
        404: { description: 'Not found or token invalid/expired' },
    },
    operationId: 'getPublicReport',
    description: 'Public, no-login report data resolved via a persistent portal token (Spectora-style tokenized link). 404 when the token is missing/expired/revoked or does not match the requested inspection.',
}, { scopes: [], tier: 'extended' }));

export const publicReportRoutes = createApiRouter()
    .openapi(reportRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { token } = c.req.valid('query');
        const access = await resolvePortalAccess(c.var.services.portalAccess, token, id);
        if (!access) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
        }
        const data = await c.var.services.inspection.getReportData(id, access.tenantId);
        return c.json({ success: true as const, data }, 200);
    });

export type PublicReportApi = typeof publicReportRoutes;

export default publicReportRoutes;
