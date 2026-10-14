import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { tenantConfigs } from '../lib/db/schema';
import { AppError, ErrorCode, Errors } from '../lib/errors';
import { packageTooLarge, readImportLimits } from '../lib/native/import-limits';
import { requireRole } from '../lib/middleware/rbac';
import { readBoundedBody } from '../lib/bounded-body';
import { importOfflinePackage } from '../services/offline-import.service';
import { getDrizzle } from '../lib/route-helpers';
import { readVersionPolicy, SERVER_CONTRACT_VERSION } from '../lib/native/client-version';
import { recordNativeClientSeen } from '../services/native-client-seen';
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
    description: 'Returns the identity behind a native access token and the tenant offline access limit, which the device uses to decide when to lock local data. When the request carries X-Client-Platform and X-Client-Version, the server also notes that this version was seen.',
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
        400: { description: 'The package is malformed, names something outside its manifest, or holds an entry whose bytes do not match the size its directory declares' },
        403: { description: 'The package belongs to another workspace, or the caller cannot edit one of its inspections' },
        409: { description: 'PACKAGE_INSPECTION_DELETED: the package would create an inspection that an earlier import created and that has since been deleted; nothing was written' },
        411: { description: 'Content-Length is required' },
        413: { description: 'PACKAGE_TOO_LARGE or BAD_REQUEST: the package exceeds the byte limit; details.limits names the limits' },
        422: { description: 'PACKAGE_TOO_LARGE: the package has more inspections, queued writes, photos or entries than this server imports at once; nothing was written. details names the limit and details.limits the sizes to split to. PACKAGE_EXPIRED: the package was exported more than details.maxAgeDays days ago; nothing was written. PACKAGE_FROM_THE_FUTURE: the package says it was exported more than details.maxFutureSkewDays day ahead of the server clock; nothing was written' },
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
        const db = getDrizzle(c);
        const row = await db.select({ days: tenantConfigs.offlineMaxDays })
            .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
        // The app calls this on every start and refresh, which makes it the place to learn which
        // versions are still in use. Throttled and bounded inside; never fails the response.
        await recordNativeClientSeen(db, tenantId, c.req.header('X-Client-Platform'), c.req.header('X-Client-Version'));
        return c.json({ success: true as const, data: {
            userId: user.sub, tenantId, role: user.role, offlineMaxDays: row?.days ?? DEFAULT_OFFLINE_MAX_DAYS,
        } }, 200);
    })
    .openapi(importOfflinePackageRoute, async (c) => {
        const limits = readImportLimits(c.env);
        const body = await readBoundedBody(c.req.raw, limits.compressedBytes, 400);
        if (!body.ok) {
            if (body.status === 413) {
                const declared = Number(c.req.header('content-length'));
                throw packageTooLarge({ limit: 'compressedBytes', max: limits.compressedBytes, actual: declared }, limits);
            }
            const message = { 400: 'Invalid Content-Length or body', 411: 'Content-Length is required' }[body.status];
            throw new AppError(body.status, ErrorCode.BAD_REQUEST, message);
        }
        const data = await importOfflinePackage(c, body.bytes, limits);
        return c.json({ success: true as const, data }, 200);
    });
