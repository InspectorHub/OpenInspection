import { createRoute, z } from '@hono/zod-openapi';
import { eq } from 'drizzle-orm';
import { tenants, tenantConfigs } from '../../lib/db/schema';
import { tenantDisplayName } from '../../lib/tenant-display-name';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { PublicBrandSchema } from '../../lib/validations/public-brand.schema';
import { isServableBrandAsset } from '../../lib/report-style/brand-asset-key';
import { getDrizzle } from '../../lib/route-helpers';
import { getBaseUrl } from '../../lib/url';
import { serveBrandAssetObject } from '../../lib/media/serve-brand-asset';

const brandRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/brand/{tenant}',
    tags: ['public'],
    summary: 'Public tenant brand (site name / accent color / logo)',
    request: { params: z.object({ tenant: z.string().describe('Tenant slug that scopes the brand lookup.') }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicBrandSchema) } }, description: 'Tenant brand (nullable fields when unset)' },
        404: { description: 'Tenant not found' },
    },
    operationId: 'getPublicBrand',
    description: 'Public, no-login tenant branding (companyName / primaryColor / logoUrl) resolved by tenant slug. Powers the consistent brand overlay on profile, booking, report, and invoice surfaces.',
}, { scopes: [], tier: 'extended' }));

const legalDocRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/legal/{tenant}/{doc}',
    tags: ['public'],
    summary: 'Hosted Privacy or Terms page content for a tenant',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant slug'),
            doc: z.enum(['privacy', 'terms']).describe('Which legal document'),
        }),
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: createApiResponseSchema(z.object({
                        companyName: z.string(),
                        body: z.string().nullable().describe('Custom body when set; null = use built-in template'),
                        lastUpdated: z.string().nullable().describe('Version of the document currently in force (YYYY-MM-DD in the tenant timezone), or null when nothing has been published yet.'),
                    })),
                },
            },
            description: 'Legal document payload',
        },
        404: { description: 'Tenant or doc not found' },
    },
    operationId: 'getPublicLegalDoc',
    description: 'Returns company name + optional custom Privacy/Terms body for /legal/:tenant/:doc pages.',
}, { scopes: [], tier: 'extended' }));

// A-10 — public brand-asset serve (tenant logos). Logos are public marketing
// assets embedded in emails and public pages; only the `branding/` R2 prefix
// is reachable here. The key contains '/', so it travels as a query param
// (mounted routers don't match multi-segment path params — see A-9).
const brandAssetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/brand-asset',
    tags: ['public'],
    summary: 'Public brand asset (tenant logo) bytes',
    request: { query: z.object({
        key: z.string().describe('R2 object key under the branding/ prefix.'),
        // A STRING, not an enum, and that is deliberate. An enum 400s on an
        // unrecognised value, which during a rolling deploy means a client
        // holding older or newer JS asks for a variant this worker does not
        // know and gets a BROKEN IMAGE. Unknown degrades to the original
        // instead: bigger than it needed to be, which is a cost, rather than
        // absent, which is a defect. `resolveBadgeVariant` owns the allowlist.
        v: z.string().optional().describe(
            'Render variant: email | reportSignature | reportCover. Badges are drawn at 28-40px ' +
            'but stored at whatever was uploaded, so this serves a size the surface can use. ' +
            'Omitted or unrecognised serves the original, never an error.',
        ),
    }) },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Asset bytes' },
        404: { description: 'Key outside branding/ or object missing' },
    },
    operationId: 'getPublicBrandAsset',
    description: 'Streams a tenant brand asset (logo) from R2. Only keys under the public `branding/` prefix are servable; everything else in the bucket stays scoped to its own routes.',
}, { scopes: [], tier: 'extended' }));

const app = createApiRouter();
app.openapi(brandRoute, async (c) => {
    const { tenant } = c.req.valid('param');
    // Resolve by slug directly (works in every deploy mode — the slug is
    // the public tenant identifier; same pattern as GET /book/:tenant/:slug).
    const db = getDrizzle(c);
    const row = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, tenant)).get();
    if (!row) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
    const brand = await c.var.services.branding.getBrand(row.id, {
        slug: tenant,
        baseUrl: getBaseUrl(c),
    });
    return c.json({ success: true as const, data: PublicBrandSchema.parse(brand) }, 200);
});
app.openapi(legalDocRoute, async (c) => {
    const { tenant, doc } = c.req.valid('param');
    const db = getDrizzle(c);
    const row = await db.select({ id: tenants.id, name: tenantDisplayName })
        .from(tenants)
        .leftJoin(tenantConfigs, eq(tenantConfigs.tenantId, tenants.id))
        .where(eq(tenants.slug, tenant)).get();
    if (!row) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
    const cfg = await db.select({
        companyName: tenantConfigs.companyName,
        privacyBody: tenantConfigs.privacyBody,
        termsBody: tenantConfigs.termsBody,
    }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, row.id)).get();
    const companyName = cfg?.companyName?.trim() || row.name;
    const body = doc === 'privacy'
        ? (cfg?.privacyBody?.trim() || null)
        : (cfg?.termsBody?.trim() || null);
    // "Last updated" comes from the version REGISTRY, never from the config
    // row's own timestamp: the registry is the only thing that knows a save
    // changed the text rather than some neighbouring setting. Null until the
    // tenant has published once, and the page then says nothing rather than
    // inventing a date.
    const latest = await c.var.services.legalVersion.latest(row.id, doc);
    // projection-allow: the company name and the published legal text shown on the inspector profile page
    return c.json({ success: true as const, data: {
        companyName, body, lastUpdated: latest?.version ?? null,
    } }, 200);
});
app.openapi(brandAssetRoute, async (c) => {
    const { key, v } = c.req.valid('query');
    if (!c.env.PHOTOS) return c.notFound();
    // Public brand-asset endpoint may ONLY serve branding logos (never arbitrary
    // R2 objects). New layout: {tenantId}/branding/logo-{uuid}.{ext}; legacy:
    // branding/{tenantId}/logo-{ts}.{ext}. Segments must be non-empty alphanumeric
    // identifiers (no ".." path traversal).
    if (!isServableBrandAsset(key)) return c.notFound();
    const asset = await serveBrandAssetObject(c.env.PHOTOS, c.env, key, v);
    return asset ?? c.notFound();
});

/** Registration order. Drives the typed client; a test pins it to what `app` really registered. */
export const publicInspectorProfileRouteConfigs = [
    brandRoute,
    legalDocRoute,
    brandAssetRoute,
] as const;

export default app;
