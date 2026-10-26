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
import { readVisibleIdsLimit, VISIBLE_ID_PATTERN } from '../lib/native/visibility-limits';
import { findVisibleInspectionIds } from '../services/native-visibility.service';
import { resolveInspectionScope } from '../lib/inspection/visibility';
import { readAccountUrl, readVersionPolicy, SERVER_CONTRACT_VERSION } from '../lib/native/client-version';
import { recordNativeClientSeen } from '../services/native-client-seen';
import {
    ClientCompatQuerySchema, ClientCompatResponseSchema, ClientSessionResponseSchema, ImportOfflinePackageResponseSchema,
    VisibleInspectionsRequestSchema, VisibleInspectionsResponseSchema,
} from '../lib/validations/client.schema';

/** Default when a tenant has no config row yet; matches the column default. */
const DEFAULT_OFFLINE_MAX_DAYS = 30;

/** Longest company name returned, in characters. */
const MAX_TENANT_NAME_CHARS = 200;

/** The company's own display name, trimmed and capped, or null. Deliberately no fallback to any default name. */
function displayName(raw: string | null | undefined): string | null {
    const name = raw?.trim();
    return name ? Array.from(name).slice(0, MAX_TENANT_NAME_CHARS).join('') : null;
}

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
        409: { description: 'PACKAGE_INSPECTION_DELETED: the package would create an inspection that an earlier import created and that has since been deleted; nothing was written. Also a CONFLICT whose details.reason is idempotency_in_flight: a queued write is being run by another request right now, so the import stopped and should be retried exactly as for a 5xx; writes already applied are skipped on the retry' },
        411: { description: 'Content-Length is required' },
        413: { description: 'PACKAGE_TOO_LARGE or BAD_REQUEST: the package exceeds the byte limit; details.limits names the limits' },
        422: { description: 'PACKAGE_TOO_LARGE: the package has more inspections, queued writes, photos or entries than this server imports at once; nothing was written. details names the limit and details.limits the sizes to split to. PACKAGE_EXPIRED: the package was exported more than details.maxAgeDays days ago; nothing was written. PACKAGE_FROM_THE_FUTURE: the package says it was exported more than details.maxFutureSkewDays day ahead of the server clock; nothing was written' },
    },
}, { scopes: ['write'], tier: 'excluded' }));

const visibleInspectionsRoute = createRoute(withMcpMetadata({
    method: 'post', path: '/inspections/visible', operationId: 'getVisibleInspections', tags: ['client'],
    summary: 'Check which local inspections the server still shows this member',
    description: 'Takes the inspection ids a native device holds and returns the ones that still exist in the signed-in company and that this member may see, in request order. An id that is missing from the answer was deleted, never existed, or is not visible to this member; the response does not say which, so a restricted member learns nothing about inspections outside their assignments. The device compares the answer with its local copies when it is back online. A failure is an error status and never an empty list. Read-only, though it is a POST so the ids travel in the body.',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { body: { required: true, content: { 'application/json': { schema: VisibleInspectionsRequestSchema } } } },
    responses: {
        200: { description: 'The requested ids that are visible to the caller', content: { 'application/json': { schema: VisibleInspectionsResponseSchema } } },
        401: { description: 'The request does not carry a native session' },
        422: { description: 'The list is empty, longer than the server limit (details.limits.ids names it), or holds an id that is not 1 to 64 characters of A-Z, a-z, 0-9, underscore or hyphen; nothing was looked up' },
    },
}, { scopes: ['read'], tier: 'excluded' }));

export const clientRoutes = createApiRouter();
clientRoutes.openapi(getClientCompatRoute, (c) => {
    const { platform } = c.req.valid('query');
    const policy = readVersionPolicy(c.env, platform);
    const accountUrl = readAccountUrl(c.env);
    return c.json({ success: true as const, data: {
        ...policy, serverContractVersion: SERVER_CONTRACT_VERSION, ...(accountUrl ? { accountUrl } : {}),
    } }, 200);
});
clientRoutes.openapi(getClientSessionRoute, async (c) => {
    const user = c.get('user');
    const tenantId = c.get('tenantId');
    if (!c.get('nativeClient') || !user || !tenantId) throw Errors.Unauthorized('Native session required');
    // The answer carries the server clock the device re-anchors its offline lock to, so an older
    // copy replayed from a cache would set that clock back.
    c.header('Cache-Control', 'private, no-store');
    const db = getDrizzle(c);
    const row = await db.select({ days: tenantConfigs.offlineMaxDays, name: tenantConfigs.companyName })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    // The app calls this on every start and refresh, which makes it the place to learn which
    // versions are still in use. Throttled and bounded inside; never fails the response.
    await recordNativeClientSeen(db, tenantId, c.req.header('X-Client-Platform'), c.req.header('X-Client-Version'));
    return c.json({ success: true as const, data: {
        userId: user.sub, tenantId, role: user.role, offlineMaxDays: row?.days ?? DEFAULT_OFFLINE_MAX_DAYS,
        tenantName: displayName(row?.name),
        // Read last, after every await, and from the server clock only: nothing the client sends reaches it.
        serverNowMs: Date.now(),
    } }, 200);
});
clientRoutes.openapi(visibleInspectionsRoute, async (c) => {
    const tenantId = c.get('tenantId');
    if (!c.get('nativeClient') || !c.get('user') || !tenantId) throw Errors.Unauthorized('Native session required');
    const { ids } = c.req.valid('json');
    const max = readVisibleIdsLimit(c.env);
    if (ids.length === 0 || ids.length > max || !ids.every((id) => VISIBLE_ID_PATTERN.test(id))) {
        throw Errors.UnprocessableEntity(
            ids.length > max
                ? `Too many ids: ${ids.length} sent, at most ${max} per request.`
                : 'ids must hold 1 or more ids of 1 to 64 characters from A-Z, a-z, 0-9, underscore and hyphen.',
            { limits: { ids: max } },
        );
    }
    const scope = await resolveInspectionScope(c);
    const visible = await findVisibleInspectionIds(getDrizzle(c), scope, tenantId, ids);
    return c.json({ success: true as const, data: { visible } }, 200);
});
clientRoutes.openapi(importOfflinePackageRoute, async (c) => {
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

/** Registration order. Drives the typed client; a test pins it to what `clientRoutes` really registered. */
export const clientRouteConfigs = [
    getClientCompatRoute,
    getClientSessionRoute,
    visibleInspectionsRoute,
    importOfflinePackageRoute,
] as const;
