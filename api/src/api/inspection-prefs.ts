/**
 * Workflow shortcuts PR — tenant-level inspector editor preferences.
 * GET returns merged defaults; PATCH validates + persists.
 */
import { createRoute } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema/tenant';
import { createApiRouter } from '../lib/openapi-router';
import {
    InspectionPrefsSchema,
    InspectionPrefsPatchSchema,
    withDefaults,
} from '../lib/validations/inspection-prefs.schema';

const getRoute = createRoute({
    method: 'get',
    path: '/',
    tags: ['Tenant'],
    summary: 'Get tenant inspection editor preferences',
    responses: {
        200: {
            description: 'Current prefs (defaults applied where unset)',
            content: { 'application/json': { schema: InspectionPrefsSchema } },
        },
    },
});

const patchRoute = createRoute({
    method: 'patch',
    path: '/',
    tags: ['Tenant'],
    summary: 'Update tenant inspection editor preferences (partial)',
    request: {
        body: { content: { 'application/json': { schema: InspectionPrefsPatchSchema } }, required: true },
    },
    responses: {
        200: {
            description: 'Merged prefs after patch',
            content: { 'application/json': { schema: InspectionPrefsSchema } },
        },
    },
});

export const inspectionPrefsRoutes = createApiRouter()
    .openapi(getRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB as never);
        const row = await db.select({ prefs: tenantConfigs.inspectionPrefs })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const merged = withDefaults(row?.prefs ?? null);
        return c.json(merged, 200);
    })
    .openapi(patchRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const patch = c.req.valid('json');
        const db = drizzle(c.env.DB as never);
        const existing = await db.select({ prefs: tenantConfigs.inspectionPrefs })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const merged = { ...withDefaults(existing?.prefs ?? null), ...patch };
        // Re-validate merged in case the patch claimed a valid field but the merged result violates max constraints.
        const parsed = InspectionPrefsSchema.parse(merged);
        await db.update(tenantConfigs)
            .set({ inspectionPrefs: parsed })
            .where(eq(tenantConfigs.tenantId, tenantId));
        return c.json(parsed, 200);
    });

export type InspectionPrefsApi = typeof inspectionPrefsRoutes;

export default inspectionPrefsRoutes;
