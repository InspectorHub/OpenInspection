/**
 * Workflow shortcuts PR — tenant-level inspector editor preferences.
 * GET returns merged defaults; PATCH validates + persists.
 */
import { createRoute } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema/tenant';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    InspectionPrefsSchema,
    InspectionPrefsPatchSchema,
    withDefaults,
} from '../lib/validations/inspection-prefs.schema';

const getRoute = withMcpMetadata(createRoute({
    method: 'get',
    path: '/',
    tags: ['inspections'],
    operationId: 'getInspectionPrefs',
    summary: 'Get tenant inspection editor preferences',
    description: 'Return the current tenant-level inspection editor preferences (clone defaults, auto-advance delay, pinned tag IDs), applying built-in defaults for any field not yet configured.',
    responses: {
        200: {
            description: 'Current prefs (defaults applied where unset)',
            content: { 'application/json': { schema: InspectionPrefsSchema } },
        },
    },
}), { scopes: ['read'], tier: 'extended' });

const patchRoute = withMcpMetadata(createRoute({
    method: 'patch',
    path: '/',
    tags: ['inspections'],
    operationId: 'updateInspectionPrefs',
    summary: 'Update tenant inspection editor preferences',
    description: 'Partially update the tenant-level inspection editor preferences. Supplied fields are merged with existing values and the result is re-validated before persisting to the tenant config.',
    request: {
        body: { content: { 'application/json': { schema: InspectionPrefsPatchSchema } }, required: true },
    },
    responses: {
        200: {
            description: 'Merged prefs after patch',
            content: { 'application/json': { schema: InspectionPrefsSchema } },
        },
    },
}), { scopes: ['write'], tier: 'extended' });

export const inspectionPrefsRoutes = createApiRouter()
    .openapi(getRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const db = drizzle(c.env.DB as never);
        const row = await db.select({
            prefs:               tenantConfigs.inspectionPrefs,
            requireDefectFields: tenantConfigs.requireDefectFields,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        // requireDefectFields rides this endpoint but lives in its own column
        // (the publish-readiness service reads it without JSON parsing).
        const merged = {
            ...withDefaults(row?.prefs ?? null),
            requireDefectFields: row?.requireDefectFields ?? 'none',
        };
        return c.json(merged, 200);
    })
    .openapi(patchRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const patch = c.req.valid('json');
        const db = drizzle(c.env.DB as never);
        const existing = await db.select({
            prefs:               tenantConfigs.inspectionPrefs,
            requireDefectFields: tenantConfigs.requireDefectFields,
        })
            .from(tenantConfigs)
            .where(eq(tenantConfigs.tenantId, tenantId))
            .get();
        const merged = {
            ...withDefaults(existing?.prefs ?? null),
            requireDefectFields: existing?.requireDefectFields ?? 'none',
            ...patch,
        };
        // Re-validate merged in case the patch claimed a valid field but the merged result violates max constraints.
        const parsed = InspectionPrefsSchema.parse(merged);
        // Split storage: requireDefectFields → its own column; everything else → the JSON blob.
        const { requireDefectFields, ...jsonPrefs } = parsed;
        await db.update(tenantConfigs)
            .set({ inspectionPrefs: jsonPrefs, requireDefectFields })
            .where(eq(tenantConfigs.tenantId, tenantId));
        return c.json(parsed, 200);
    });

export type InspectionPrefsApi = typeof inspectionPrefsRoutes;

export default inspectionPrefsRoutes;
