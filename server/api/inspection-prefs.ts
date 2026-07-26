/**
 * Workflow shortcuts PR — tenant-level inspector editor preferences.
 * GET returns merged defaults; PATCH validates + persists.
 */
import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../lib/db/schema/tenant';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { reportLinkExpiresAt } from '../lib/report-link-ttl';
import { ReportLinkTtlSchema } from '../lib/validations/report-link-ttl.schema';
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

/**
 * IA-36 ⑥ — act on the links that ALREADY exist.
 *
 * Separate from PATCH / on purpose. Saving `reportLinkTtl` is future-only: it
 * governs links minted from that moment on and never re-dates one already in a
 * customer's inbox. Turning "never" into "30 days" as a silent side effect of
 * saving a setting would kill every link older than 30 days at once — the
 * accident this whole item was opened about.
 *
 * So the backlog gets its own verb, and the UI labels it with the count it is
 * about to affect ("Expire 47 links") rather than a harmless "Apply".
 */
const bulkExpiryRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/report-link-expiry',
    tags: ['inspections'],
    summary: 'Apply an expiry to the report links that already exist',
    request: {
        body: { content: { 'application/json': { schema: z.object({ ttl: ReportLinkTtlSchema }) } }, required: true },
    },
    responses: {
        200: {
            description: 'How many live links were re-dated, and the resulting absolute expiry.',
            content: { 'application/json': { schema: z.object({ affected: z.number().int(), expiresAt: z.number().nullable() }) } },
        },
    },
    operationId: 'applyTenantReportLinkExpiry',
    description: 'Applies an expiry, expressed as a duration from now, to every report link across the tenant that is usable right now (not revoked, not already expired). The tenant reportLinkTtl policy alone only affects links minted after it changes; this is the explicit, count-reporting way to act on the existing backlog. Already-dead links are left dead — a bulk apply never resurrects one.',
}, { scopes: ['write'], tier: 'extended' }));

/**
 * The number the button has to say out loud. Read on page load so
 * "Expire 47 links" is 47 before the operator commits, not after.
 */
const liveLinkCountRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report-link-expiry',
    tags: ['inspections'],
    summary: 'How many report links are usable right now',
    responses: {
        200: {
            description: 'Count of tenant report links that are neither revoked nor already expired.',
            content: { 'application/json': { schema: z.object({ liveLinks: z.number().int() }) } },
        },
    },
    operationId: 'getTenantLiveReportLinkCount',
    description: 'Counts the report links across the tenant that would be affected by applying an expiry to the existing backlog. Rendered into the confirm control so the operator sees the blast radius before acting, not after.',
}, { scopes: ['read'], tier: 'extended' }));

const inspectionPrefsRoutes = createApiRouter()
    .openapi(liveLinkCountRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const liveLinks = await c.var.services.portalAccess.countLiveLinksForTenant(tenantId);
        return c.json({ liveLinks }, 200);
    })
    .openapi(bulkExpiryRoute, async (c) => {
        const tenantId = c.get('tenantId') as string;
        const { ttl } = c.req.valid('json');
        const expiresAt = reportLinkExpiresAt(ttl, Date.now());
        const affected = await c.var.services.portalAccess.setExpiryForTenant(tenantId, expiresAt);
        return c.json({ affected, expiresAt }, 200);
    })
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
