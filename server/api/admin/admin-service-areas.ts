// Admin → Inspector service areas sub-router.
//
// The ZIP territories that feed geographic eligibility on the booking pipeline
// (`server/lib/booking/eligibility.ts`). Zero rows for an inspector means they
// serve everywhere, so the DELETE-then-INSERT replace below is the only write
// shape: there is no "remove one ZIP" endpoint, because a partial failure
// would leave a territory nobody intended.
//
// Mounted through `server/api/admin.ts` (not server/index.ts) so every
// /api/admin path keeps coming from server/api/admin/.
import { createRoute } from '@hono/zod-openapi';
import { and, eq } from 'drizzle-orm';
import { createApiRouter } from '../../lib/openapi-router';
import { requireRole } from '../../lib/middleware/rbac';
import { getDrizzle } from '../../lib/route-helpers';
import { Errors } from '../../lib/errors';
import { auditFromContext } from '../../lib/audit';
import { inspectorServiceAreas, users } from '../../lib/db/schema';
import {
    ServiceAreaQuerySchema,
    ReplaceServiceAreasSchema,
    ServiceAreaListResponseSchema,
    ServiceAreaMapResponseSchema,
} from '../../lib/validations/service-area.schema';
import { withMcpMetadata } from '../../lib/route-metadata-standards';

/* ── GET /api/admin/service-areas?userId= ─────────────────────────────────── */
const getServiceAreasRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/service-areas',
    tags: ['admin'],
    summary: 'List the ZIP prefixes one inspector serves',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { query: ServiceAreaQuerySchema },
    responses: {
        200: { content: { 'application/json': { schema: ServiceAreaListResponseSchema } }, description: 'The inspector ZIP list' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listInspectorServiceAreas',
    description: 'Returns the ZIP prefixes this inspector will travel to. An empty list means they serve every area.',
}, { scopes: ['admin'], tier: 'extended' }));

/* ── GET /api/admin/service-areas/all ─────────────────────────────────────── */
const getAllServiceAreasRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/service-areas/all',
    tags: ['admin'],
    summary: 'List every declared inspector territory in the tenant',
    middleware: [requireRole('owner', 'manager')] as const,
    request: {},
    responses: {
        200: { content: { 'application/json': { schema: ServiceAreaMapResponseSchema } }, description: 'Declared territories' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'listAllInspectorServiceAreas',
    description: 'Returns every inspector that has declared at least one ZIP prefix. Inspectors absent from the list serve every area.',
}, { scopes: ['admin'], tier: 'extended' }));

/* ── PUT /api/admin/service-areas ─────────────────────────────────────────── */
const replaceServiceAreasRoute = createRoute(withMcpMetadata({
    method: 'put', path: '/service-areas',
    tags: ['admin'],
    summary: 'Replace one inspector ZIP list',
    middleware: [requireRole('owner', 'manager')] as const,
    request: { body: { content: { 'application/json': { schema: ReplaceServiceAreasSchema } } } },
    responses: {
        200: { content: { 'application/json': { schema: ServiceAreaListResponseSchema } }, description: 'The stored list' },
        404: { description: 'Inspector not found in this tenant' },
    },
    security: [{ bearerAuth: [] }],
    operationId: 'replaceInspectorServiceAreas',
    description: 'Replaces the inspector ZIP list wholesale. Sending an empty array clears the territory, which means they serve every area again.',
}, { scopes: ['admin'], tier: 'extended' }));

const adminServiceAreasRoutes = createApiRouter()
    .openapi(getServiceAreasRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { userId } = c.req.valid('query');
        const rows = await getDrizzle(c).select({ zipPrefix: inspectorServiceAreas.zipPrefix })
            .from(inspectorServiceAreas)
            .where(and(
                eq(inspectorServiceAreas.tenantId, tenantId),
                eq(inspectorServiceAreas.userId, userId),
            )).all();
        return c.json({
            success: true as const,
            data: { userId, zipPrefixes: rows.map(r => r.zipPrefix).sort() },
        }, 200);
    })
    .openapi(getAllServiceAreasRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const rows = await getDrizzle(c).select({
            userId: inspectorServiceAreas.userId,
            zipPrefix: inspectorServiceAreas.zipPrefix,
        }).from(inspectorServiceAreas)
            .where(eq(inspectorServiceAreas.tenantId, tenantId)).all();
        const byUser = new Map<string, string[]>();
        for (const row of rows) {
            const list = byUser.get(row.userId) ?? [];
            list.push(row.zipPrefix);
            byUser.set(row.userId, list);
        }
        return c.json({
            success: true as const,
            data: [...byUser.entries()]
                .map(([userId, zipPrefixes]) => ({ userId, zipPrefixes: zipPrefixes.sort() }))
                .sort((a, b) => a.userId.localeCompare(b.userId)),
        }, 200);
    })
    .openapi(replaceServiceAreasRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const { userId, zipPrefixes } = c.req.valid('json');
        const db = getDrizzle(c);

        // The inspector must belong to THIS tenant. Without this a tampered
        // userId would write territory rows keyed to a stranger, and the
        // eligibility filter would then read them back under our tenant id.
        const member = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.id, userId), eq(users.tenantId, tenantId))).get();
        if (!member) throw Errors.NotFound('Inspector not found.');

        // De-duplicate before writing: the unique index would reject a repeat
        // and a client that typed "78701, 78701" meant one ZIP, not an error.
        const unique = [...new Set(zipPrefixes)].sort();

        await db.delete(inspectorServiceAreas).where(and(
            eq(inspectorServiceAreas.tenantId, tenantId),
            eq(inspectorServiceAreas.userId, userId),
        ));
        if (unique.length > 0) {
            const now = new Date();
            // D1 binds 100 parameters per statement and each row binds 5, so
            // chunk rather than trusting the list to stay short.
            const CHUNK = 20;
            for (let i = 0; i < unique.length; i += CHUNK) {
                await db.insert(inspectorServiceAreas).values(
                    unique.slice(i, i + CHUNK).map(zipPrefix => ({
                        id: crypto.randomUUID(),
                        tenantId,
                        userId,
                        zipPrefix,
                        createdAt: now,
                    })),
                );
            }
        }

        auditFromContext(c, 'config.service_areas.replace', 'inspector_service_areas', {
            entityId: userId,
            metadata: { zipPrefixes: unique },
        });
        return c.json({ success: true as const, data: { userId, zipPrefixes: unique } }, 200);
    });

export type AdminServiceAreasApi = typeof adminServiceAreasRoutes;
export default adminServiceAreasRoutes;
