import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { tenantConfigs } from '../lib/db/schema';
import { AppError, ErrorCode, Errors } from '../lib/errors';
import { requireRole } from '../lib/middleware/rbac';
import { readPackageBody } from '../lib/native/offline-zip';
import { importOfflinePackage } from '../services/offline-import.service';
import { getDrizzle } from '../lib/route-helpers';
import { readVersionPolicy, SERVER_CONTRACT_VERSION } from '../lib/native/client-version';
import {
    ClientCompatQuerySchema, ClientCompatResponseSchema, ClientSessionResponseSchema, ImportOfflinePackageResponseSchema,
} from '../lib/validations/client.schema';

/** Default when a tenant has no config row yet; matches the column default. */
const DEFAULT_OFFLINE_MAX_DAYS = 30;

const getClientCompatRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/compat', operationId: 'getClientCompat', tags: ['client'],
    summary: 'Get native client version compatibility policy',
    description: 'Returns the minimum supported and recommended native app versions for a platform, where to download updates, and the server contract version. Public: a client calls it before signing in.',
    request: { query: ClientCompatQuerySchema },
    responses: { 200: { description: 'Compatibility policy for the platform', content: { 'application/json': { schema: ClientCompatResponseSchema } } } },
}, { scopes: ['read'], tier: 'excluded' }));

const getClientSessionRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/session', operationId: 'getClientSession', tags: ['client'],
    summary: 'Get the signed-in native client session',
    description: 'Returns the identity behind a native access token and the tenant offline access limit, which the device uses to decide when to lock local data.',
    responses: { 200: { description: 'Native session', content: { 'application/json': { schema: ClientSessionResponseSchema } } } },
}, { scopes: ['read'], tier: 'excluded' }));

const importOfflinePackageRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/import', operationId: 'importOfflinePackage', tags: ['client'],
    summary: 'Import an exported offline data package',
    description: 'Imports a zip written by a native device that could not sync, on behalf of the signed-in member. The whole package is validated and every inspection in it is authorized for the caller before anything is written, so a package that names one inspection the caller may not edit changes nothing. Importing the same package again is safe and reports its queued writes as skipped. Requires a Content-Length header.',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { body: { required: true, content: { 'application/zip': { schema: z.string().openapi({ type: 'string', format: 'binary' }) } } } },
    responses: {
        200: { description: 'Package imported', content: { 'application/json': { schema: ImportOfflinePackageResponseSchema } } },
        400: { description: 'The package is malformed, or names something outside its manifest' },
        403: { description: 'The package belongs to another workspace, or the caller cannot edit one of its inspections' },
        411: { description: 'Content-Length is required' },
        413: { description: 'The package exceeds the size limit' },
    },
}, { scopes: ['write'], tier: 'excluded' }));

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
    })
    .openapi(importOfflinePackageRoute, async (c) => {
        const body = await readPackageBody(c.req.raw);
        if (!body.ok) {
            const message = { 400: 'Invalid Content-Length or body', 411: 'Content-Length is required', 413: 'Offline package is too large' }[body.status];
            throw new AppError(body.status, ErrorCode.BAD_REQUEST, message);
        }
        const data = await importOfflinePackage(c, body.bytes);
        return c.json({ success: true as const, data }, 200);
    });
