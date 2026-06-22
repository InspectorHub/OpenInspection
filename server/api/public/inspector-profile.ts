import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../../lib/db/schema';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';

// Public inspector marketing profile (by slug). Tenant resolves from the
// slug (no token — public page); returns whitelisted public fields only.
const PublicInspectorProfileSchema = z.object({
    profile: z.object({
        name: z.string().nullable(),
        bio: z.string().nullable(),
        photoUrl: z.string().nullable(),
        slug: z.string().nullable(),
        serviceAreas: z.array(z.object({ city: z.string(), state: z.string() })),
    }).nullable(),
    services: z.array(z.object({
        id: z.string(),
        name: z.string(),
        description: z.string().nullable().optional(),
        priceCents: z.number().nullable().optional(),
        durationMinutes: z.number().nullable().optional(),
    })),
});

const inspectorRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspector/{tenant}/{slug}',
    tags: ['public'],
    summary: 'Public inspector marketing profile',
    request: { params: z.object({
        tenant: z.string().describe('Tenant slug that scopes the inspector lookup.'),
        slug: z.string().describe('Public inspector profile slug.'),
    }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicInspectorProfileSchema) } }, description: 'Public profile + bookable services' },
        404: { description: 'Tenant or inspector not found' },
    },
    operationId: 'getPublicInspectorProfile',
    description: 'Public, no-login inspector profile resolved by tenant slug + slug. Returns only public marketing fields (name/bio/photo/serviceAreas) + bookable services — never email/phone/license/ids.',
}, { scopes: [], tier: 'extended' }));

// A-10 — the canonical tenant brand every public surface paints with.
// Fields are nullable verbatim from tenant_configs; null primaryColor means
// "keep the platform design tokens" (no per-surface fallback drift).
export const PublicBrandSchema = z.object({
    companyName: z.string().nullable(),
    primaryColor: z.string().nullable(),
    logoUrl: z.string().nullable(),
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

export const publicInspectorProfileRoutes = createApiRouter()
    .openapi(inspectorRoute, async (c) => {
        const { tenant, slug } = c.req.valid('param');
        // A-10 — resolve by the URL slug directly (same pattern as
        // GET /book/:tenant/:slug and /brand/:tenant): the slug IS the public
        // tenant identifier, and context resolution doesn't run for in-process
        // /api/public/* calls.
        const db = drizzle(c.env.DB);
        const row = await db.select({ id: tenants.id }).from(tenants).where(eq(tenants.slug, tenant)).get();
        const tenantId = row?.id ?? ((c.get('resolvedTenantId') || c.get('tenantId')) as string | null);
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Inspector not found' } }, 404);
        const profile = await c.var.services.user.getProfileBySlug(tenantId, slug);
        const services = await c.var.services.service.listServices(tenantId);
        return c.json({
            success: true as const,
            data: {
                profile: profile ? {
                    name: profile.name, bio: profile.bio, photoUrl: profile.photoUrl,
                    slug: profile.slug, serviceAreas: profile.serviceAreas,
                } : null,
                services,
            },
        }, 200);
    })
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
