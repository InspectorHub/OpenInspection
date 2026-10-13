import { createRoute } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { tenantConfigs } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { getDrizzle } from '../lib/route-helpers';
import { readVersionPolicy, SERVER_CONTRACT_VERSION } from '../lib/native/client-version';
import {
    ClientCompatQuerySchema, ClientCompatResponseSchema, ClientSessionResponseSchema,
} from '../lib/validations/client.schema';

/** Default when a tenant has no config row yet; matches the column default. */
const DEFAULT_OFFLINE_MAX_DAYS = 30;

export const getClientCompatRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/compat', operationId: 'getClientCompat', tags: ['client'],
    summary: 'Get native client version compatibility policy',
    description: 'Returns the minimum supported and recommended native app versions for a platform, where to download updates, and the server contract version. Public: a client calls it before signing in.',
    request: { query: ClientCompatQuerySchema },
    responses: { 200: { description: 'Compatibility policy for the platform', content: { 'application/json': { schema: ClientCompatResponseSchema } } } },
}, { scopes: ['read'], tier: 'excluded' }));

export const getClientSessionRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/session', operationId: 'getClientSession', tags: ['client'],
    summary: 'Get the signed-in native client session',
    description: 'Returns the identity behind a native access token and the tenant offline access limit, which the device uses to decide when to lock local data.',
    responses: { 200: { description: 'Native session', content: { 'application/json': { schema: ClientSessionResponseSchema } } } },
}, { scopes: ['read'], tier: 'excluded' }));

export const clientRoutes = createApiRouter()
    .openapi(getClientCompatRoute, (c) => {
        const { platform } = c.req.valid('query');
        const policy = readVersionPolicy(c.env, platform);
        return c.json({ success: true as const, data: { ...policy, serverContractVersion: SERVER_CONTRACT_VERSION } }, 200);
    })
    .openapi(getClientSessionRoute, async (c) => {
        const user = c.get('user');
        const tenantId = c.get('tenantId');
        if (!c.get('nativeClient') || !user || !tenantId) throw Errors.Unauthorized('Native session required');
        const row = await getDrizzle(c).select({ days: tenantConfigs.offlineMaxDays })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        return c.json({ success: true as const, data: {
            userId: user.sub, tenantId, role: user.role, offlineMaxDays: row?.days ?? DEFAULT_OFFLINE_MAX_DAYS,
        } }, 200);
    });
