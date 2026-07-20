import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';

// A-10 — the canonical tenant brand every public surface paints with.
// Fields are nullable verbatim from tenant_configs; null primaryColor means
// "keep the platform design tokens" (no per-surface fallback drift).
export const PublicBrandSchema = z.object({
    companyName: z.string().nullable(),
    primaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
    // Tenant display timezone (IANA; 'UTC' when unset). Public/report surfaces
    // anchor displayed inspection dates to this zone.
    defaultTimezone: z.string().default('UTC'),
});

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

// A-10 — public brand-asset serve (tenant logos). Logos are public marketing
// assets embedded in emails and public pages; only the `branding/` R2 prefix
// is reachable here. The key contains '/', so it travels as a query param
// (mounted routers don't match multi-segment path params — see A-9).
const brandAssetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/brand-asset',
    tags: ['public'],
    summary: 'Public brand asset (tenant logo) bytes',
    request: { query: z.object({ key: z.string().describe('R2 object key under the branding/ prefix.') }) },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Asset bytes' },
        404: { description: 'Key outside branding/ or object missing' },
    },
    operationId: 'getPublicBrandAsset',
    description: 'Streams a tenant brand asset (logo) from R2. Only keys under the public `branding/` prefix are servable; everything else in the bucket stays scoped to its own routes.',
}, { scopes: [], tier: 'extended' }));

const publicInspectorProfileRoutes = createApiRouter()
    .openapi(brandRoute, async (c) => {
        const { tenant } = c.req.valid('param');
        // Resolve by slug directly (works in every deploy mode — the slug is
        // the public tenant identifier; same pattern as GET /book/:tenant/:slug).
        const db = drizzle(c.env.DB);
        const row = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, tenant)).get();
        if (!row) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Tenant not found' } }, 404);
        const brand = await c.var.services.branding.getBrand(row.id);
        return c.json({ success: true as const, data: brand }, 200);
    })
    .openapi(brandAssetRoute, async (c) => {
        const { key } = c.req.valid('query');
        if (!c.env.PHOTOS) return c.notFound();
        // Public brand-asset endpoint may ONLY serve branding logos (never arbitrary
        // R2 objects). New layout: {tenantId}/branding/logo-{uuid}.{ext}; legacy:
        // branding/{tenantId}/logo-{ts}.{ext}. Segments must be non-empty alphanumeric
        // identifiers (no ".." path traversal).
        const isBrandingLogo = /^[^/.][^/]*\/branding\/logo-[^/]+$/.test(key) || /^branding\/[^/.][^/]*\/logo-[^/]+$/.test(key);
        if (!isBrandingLogo) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();
        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=3600');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    });

export default publicInspectorProfileRoutes;
