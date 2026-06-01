import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { ReportDataResponseSchema } from '../lib/validations/inspection.schema';
import { resolvePortalAccess } from '../lib/public-access';

/**
 * Public, no-login portal endpoints (`/api/public/*`). Access is gated by the
 * persistent per-(recipient, order) portal token (Spectora/ISN tokenized-link
 * model). The token is the credential; tenantId is resolved from it, NEVER from
 * the URL `:tenant` segment. See plan 2026-06-01-core-public-endpoints-c10-residual.
 */

const reportRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}',
    tags: ['public'],
    summary: 'Public token-gated inspection report data',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant subdomain (display only; tenant is resolved from the token).'),
            id: z.string().describe('Inspection id.'),
        }),
        query: z.object({ token: z.string().optional().describe('Persistent portal access token.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ReportDataResponseSchema) } }, description: 'Report data' },
        404: { description: 'Not found or token invalid/expired' },
    },
    operationId: 'getPublicReport',
    description: 'Public, no-login report data resolved via a persistent portal token (Spectora-style tokenized link). 404 when the token is missing/expired/revoked or does not match the requested inspection.',
}, { scopes: [], tier: 'extended' }));

// Public inspector marketing profile (by slug). Tenant resolves from the
// subdomain (no token — public page); returns whitelisted public fields only.
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
    request: { params: z.object({ tenant: z.string(), slug: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicInspectorProfileSchema) } }, description: 'Public profile + bookable services' },
        404: { description: 'Tenant or inspector not found' },
    },
    operationId: 'getPublicInspectorProfile',
    description: 'Public, no-login inspector profile resolved by tenant subdomain + slug. Returns only public marketing fields (name/bio/photo/serviceAreas) + bookable services — never email/phone/license/ids.',
}, { scopes: [], tier: 'extended' }));

// Public invoice for the report-gate "Pay invoice" CTA (by inspection id;
// tenant resolves from subdomain). The id is unguessable; tenant-scoped query.
const PublicInvoiceSchema = z.object({
    id: z.string(),
    amountCents: z.number(),
    status: z.string(),
    dueDate: z.string().nullable().optional(),
    lineItems: z.array(z.object({ description: z.string(), amountCents: z.number() })).optional(),
}).nullable();

const invoiceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/r/{id}/invoice',
    tags: ['public'],
    summary: 'Public invoice for an inspection (pay-link landing)',
    request: { params: z.object({ id: z.string() }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicInvoiceSchema) } }, description: 'Invoice (or null if none)' },
        404: { description: 'Tenant not resolved' },
    },
    operationId: 'getPublicInvoice',
    description: 'Public, no-login invoice for an inspection (the unguessable id is the key). Tenant resolved from subdomain; tenant-scoped query.',
}, { scopes: [], tier: 'extended' }));

export const publicReportRoutes = createApiRouter()
    .openapi(reportRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { token } = c.req.valid('query');
        const access = await resolvePortalAccess(c.var.services.portalAccess, token, id);
        if (!access) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
        }
        const data = await c.var.services.inspection.getReportData(id, access.tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(inspectorRoute, async (c) => {
        const { slug } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
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
    .openapi(invoiceRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
        const inv = await c.var.services.invoice.findByInspectionId(tenantId, id);
        return c.json({ success: true as const, data: inv }, 200);
    });

export type PublicReportApi = typeof publicReportRoutes;

export default publicReportRoutes;
