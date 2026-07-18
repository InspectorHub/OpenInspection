import type { Context } from 'hono';
import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import type { HonoConfig } from '../types/hono';
import { inspections } from '../lib/db/schema';
import { verifyRenderToken } from '../lib/render-token';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { ReportDataResponseSchema } from '../lib/validations/inspection.schema';
import { resolvePortalAccess, resolveObserverAccess, resolveOwnerPreview } from '../lib/public-access';
// Re-export so existing callers that import resolveOwnerPreviewToken from this
// module (e.g. tests) continue to work without changes.
export { resolveOwnerPreviewToken } from '../lib/public-access';
import { contentDisposition } from '../lib/content-disposition';
import { InvoiceNotPayableError } from '../lib/stripe-helpers';
import { logger } from '../lib/logger';
import { buildRenderReportUrl } from '../lib/public-urls';
import { getBookingHost } from '../lib/url';
import { publicReportAccessAllowed } from '../lib/report-access';
import publicVerifyRoutes from './public/verify';
import publicInspectorProfileRoutes, { PublicBrandSchema } from './public/inspector-profile';

/**
 * Render-token access path for headless PDF generation. The Cloudflare Browser
 * Rendering headless browser cannot carry a session cookie or portal token, so
 * trusted server flows mint a short-TTL render token (see lib/render-token.ts)
 * and pass it as `?render=`. Returns the token's inspectionId only when it is
 * valid AND matches the requested inspection; null otherwise (caller falls
 * through to the other auth paths / 404).
 */
export async function resolveRenderAccess(
    render: string | undefined, requestedId: string, secret: string,
): Promise<{ inspectionId: string } | null> {
    if (!render) return null;
    const v = await verifyRenderToken(render, secret);
    if (!v || v.inspectionId !== requestedId) return null;
    return v;
}

/**
 * Shared client-facing tenant resolution for the public report endpoints:
 * the persistent per-(recipient, order) portal token, falling back to the
 * legacy KV agent-view-token bridge (`?view=agent&token=`). Returns the
 * AUTHORITATIVE tenantId from whichever token resolves to THIS inspection, or
 * null. Identical across the report-data, report-photo, and report-PDF routes.
 */
async function resolveClientTenant(
    c: Context<HonoConfig>, token: string | undefined, id: string,
): Promise<string | null> {
    const tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
    if (tenantId || !token) return tenantId;
    // Bridge: existing customer share links carry the KV agent-view-token until
    // persistent per-recipient token issuance is wired (see plan
    // 2026-06-01-core-esign-redesign). Validate it the same way: token must
    // resolve to THIS inspection; tenantId from the token.
    const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
    if (legacy && legacy.inspectionId === id) return legacy.tenantId;
    return null;
}

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
            tenant: z.string().describe('Tenant slug (display only; tenant is resolved from the token).'),
            id: z.string().describe('Inspection id.'),
        }),
        query: z.object({
            token: z.string().optional().describe('Persistent portal access token.'),
            render: z.string().optional().describe('Server-minted render token (headless PDF only).'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ReportDataResponseSchema) } }, description: 'Report data' },
        404: { description: 'Not found or token invalid/expired' },
    },
    operationId: 'getPublicReport',
    description: 'Public, no-login report data resolved via a persistent portal token (Spectora-style tokenized link). 404 when the token is missing/expired/revoked or does not match the requested inspection.',
}, { scopes: [], tier: 'extended' }));

// A-9 — Public token-scoped photo serve for the no-login report viewer. Mirrors
// the authed editor serve route, but resolves the tenant from the portal/share
// token (NEVER the `:tenant` path segment) and confirms the photo key belongs to
// that tenant + inspection before streaming. The R2 key (which contains '/')
// travels as a query param to avoid path-segment splitting.
const reportPhotoRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}/photo',
    tags: ['public'],
    summary: 'Public token-gated inspection photo',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant slug (display only; tenant is resolved from the token).'),
            id: z.string().describe('Inspection id.'),
        }),
        query: z.object({
            key: z.string().describe('R2 object key (`${tenantId}/${inspectionId}/...`).'),
            token: z.string().optional().describe('Persistent portal access token.'),
            download: z.string().optional().describe('Set to "1" to force an attachment download named after the original file.'),
            render: z.string().optional().describe('Server-minted render token (headless PDF only).'),
            w: z.string().optional().describe('Optional max width in px for an on-the-fly WebP thumbnail; omitted serves the original.'),
        }),
    },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Photo bytes' },
        404: { description: 'Not found or token invalid/expired' },
    },
    operationId: 'getPublicReportPhoto',
    description: 'Public, no-login inspection photo gated by the same portal token as the report data. 404 when the token is invalid or the key is outside the token\'s tenant + inspection.',
}, { scopes: [], tier: 'extended' }));

// Public token-gated report PDF download. Mirrors the owner on-demand PDF
// endpoint (Task 7) but authenticates via the persistent portal token only —
// no owner-preview, no render-token acceptance (the handler mints its own
// render token internally for the headless renderer).
const reportPdfDownloadRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report/{tenant}/{id}/pdf',
    tags: ['public'],
    summary: 'Public token-gated report PDF download',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant slug (display only; tenant is resolved from the token).'),
            id: z.string().describe('Inspection id.'),
        }),
        query: z.object({
            token: z.string().optional().describe('Persistent portal access token.'),
            type: z.enum(['summary', 'full']).optional().describe('Report variant. Defaults to full.'),
        }),
    },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any().describe('Report PDF bytes') } }, description: 'Report PDF' },
        404: { description: 'Not found or token invalid/expired' },
        503: { description: 'PDF rendering is not configured on this deployment' },
    },
    operationId: 'getPublicReportPdf',
    description: 'Public, no-login report PDF resolved via a persistent portal token. Renders on demand and caches by version (published reports = immutable archive). 404 when the token is missing/expired/revoked or does not match the inspection.',
}, { scopes: [], tier: 'extended' }));

// Public invoice for the report-gate "Pay invoice" CTA (by inspection id;
// tenant resolves from slug). The id is unguessable; tenant-scoped query.
const PublicInvoiceSchema = z.object({
    id: z.string(),
    amountCents: z.number(),
    // Phase B — the invoice's snapshot currency (ISO 4217); the pay page renders
    // this, not the tenant's live setting, so history stays self-describing.
    currency: z.string().optional(),
    status: z.string(),
    createdAt: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    lineItems: z.array(z.object({ description: z.string(), amountCents: z.number() })).optional(),
    brand: PublicBrandSchema.optional(),
}).nullable();

const invoiceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{id}/invoice',
    tags: ['public'],
    summary: 'Public invoice for an inspection (pay-link landing)',
    request: { params: z.object({ id: z.string().describe('Inspection id the invoice belongs to.') }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicInvoiceSchema) } }, description: 'Invoice (or null if none)' },
        404: { description: 'Tenant not resolved' },
    },
    operationId: 'getPublicInvoice',
    description: 'Public, no-login invoice for an inspection (the unguessable id is the key). Tenant resolved from slug; tenant-scoped query.',
}, { scopes: [], tier: 'extended' }));

// Public Stripe PaymentIntent mint for the invoice pay-panel (bring-your-own-keys:
// the tenant's OWN Stripe secret key is loaded per-request into c.env by the
// integration-secrets middleware). Returns the client secret + the tenant's
// publishable key so the browser can mount Stripe Elements inline.
const PayIntentSchema = z.object({
    clientSecret: z.string(),
    publishableKey: z.string(),
    amountCents: z.number(),
});

const payIntentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/pay-intent',
    tags: ['public'],
    summary: 'Start a Stripe card payment for an inspection invoice',
    request: { params: z.object({ id: z.string().describe('Inspection id the invoice belongs to.') }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PayIntentSchema) } }, description: 'PaymentIntent client secret + publishable key' },
        404: { description: 'Tenant or invoice not found' },
        409: { description: 'Invoice is not payable (already paid / $0)' },
        503: { description: 'Stripe is not configured for this tenant, or the charge could not be started' },
    },
    operationId: 'createPublicPayIntent',
    description: "Mints a Stripe PaymentIntent for the inspection's invoice using the tenant's own Stripe keys. Public — the unguessable inspection id is the key; tenant resolved from slug.",
}, { scopes: [], tier: 'extended' }));

// Public live-observer view (③-A.4). Gated by an OBSERVER-link token (distinct
// from the portal token) carried in `?token=`; tenantId resolves from the
// claimed link, never the URL. Returns read-only section progress.
const ObserveResponseSchema = z.object({
    address: z.string(),
    date: z.string().nullable(),
    inspectorName: z.string(),
    status: z.string(),
    sections: z.array(z.object({
        name: z.string(),
        completedItems: z.number(),
        totalItems: z.number(),
    })),
});

const observeRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/observe/inspections/{id}',
    tags: ['public'],
    summary: 'Public live observer progress (token-gated)',
    request: {
        params: z.object({ id: z.string().describe('Inspection id.') }),
        query: z.object({ token: z.string().optional().describe('Observer-link token.') }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ObserveResponseSchema) } }, description: 'Live section progress' },
        404: { description: 'Observer link missing/expired/revoked or inspection mismatch' },
    },
    operationId: 'getPublicObserve',
    description: 'Public, no-login live progress for an in-flight inspection, gated by an observer-link token. 404 when the link is invalid/expired/revoked or does not grant access to the requested inspection.',
}, { scopes: [], tier: 'extended' }));

// Public report-gate (③-A.2). The "report blocked, here's why + CTA" page,
// resolved by tenant slug + id (no token — pre-report). Returns only
// non-sensitive gate fields (reason + branding + inspector contact + amount).
const ReportGateResponseSchema = z.object({
    reason: z.enum(['payment', 'agreement']),
    companyName: z.string(),
    primaryColor: z.string().nullable(),
    actionUrl: z.string(),
    actionLabel: z.string(),
    propertyAddress: z.string().nullable(),
    inspectorName: z.string().nullable(),
    inspectorEmail: z.string().nullable(),
    inspectorPhone: z.string().nullable(),
    inspectorLicense: z.string().nullable(),
    scheduledDate: z.string().nullable(),
    amountCents: z.number().nullable(),
    currency: z.string().nullable(),
    locale: z.string(),
}).nullable();

const reportGateRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/report-gate/{tenant}/{id}',
    tags: ['public'],
    summary: 'Public report-gate status (why the report is blocked + CTA)',
    request: {
        params: z.object({
            tenant: z.string().describe('Tenant slug (display + CTA-URL building; tenant is resolved from the slug).'),
            id: z.string().describe('Inspection id.'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ReportGateResponseSchema) } }, description: 'Gate payload (or null when the report is not gated)' },
        404: { description: 'Tenant not resolved' },
    },
    operationId: 'getPublicReportGate',
    description: 'Public, no-login report-gate status resolved by tenant slug + inspection id. Returns the outstanding gate (agreement before payment) with branding, inspector contact, and amount due — or null when the report is not gated.',
}, { scopes: [], tier: 'extended' }));

const publicReportRoutes = createApiRouter()
    .route('/', publicVerifyRoutes)
    .openapi(reportRoute, async (c) => {
        const { tenant, id } = c.req.valid('param');
        const { token, render } = c.req.valid('query');
        let tenantId = await resolveClientTenant(c, token, id);
        // Render-token path: headless CF Browser Rendering cannot carry a session
        // cookie or portal token; trusted server flows mint a short-TTL render token
        // and pass it as `?render=`. Resolve tenantId from the inspection row so the
        // headless browser can load the full report without any user credential.
        let renderMode = false;
        if (!tenantId && render) {
            const r = await resolveRenderAccess(render, id, c.env.JWT_SECRET);
            if (r) {
                const db = drizzle(c.env.DB);
                const row = await db.select({ tenantId: inspections.tenantId })
                    .from(inspections).where(eq(inspections.id, id)).get();
                if (row) { tenantId = row.tenantId; renderMode = true; }
            }
        }
        // Owner-session preview: an authenticated tenant user (inspector/admin)
        // may preview their own report without a recipient token. Ownership of
        // THIS inspection is enforced by getReportData's tenant-scoped query.
        let ownerPreview = false;
        if (!tenantId) { tenantId = await resolveOwnerPreview(c); ownerPreview = !!tenantId; }
        if (!tenantId) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
        }
        // Publish gate: client/token access is revoked while the report is not
        // published (owner-preview + render-token bypass — they may view drafts).
        const gateRow = await drizzle(c.env.DB)
            .select({ reportStatus: inspections.reportStatus })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!publicReportAccessAllowed({ renderMode, ownerPreview, reportStatus: gateRow?.reportStatus })) {
            return c.json({ success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } }, 403);
        }
        // Photo URLs: render mode carries the render token so the headless browser
        // can load photos without a session cookie. Owner-preview points at the
        // authed editor photo route (cookie authenticates there). Public client
        // viewers use the token-scoped public photo route.
        const tk = token ?? '';
        const makePhotoUrl = renderMode
            ? (key: string) => `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}&render=${encodeURIComponent(render!)}`
            : ownerPreview
                ? (key: string) => `/api/inspections/${id}/photo?key=${encodeURIComponent(key)}`
                : (key: string) => `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(tk)}`;
        // Plan 7 — video media context. `renderMode` (the render-token/PDF path)
        // forces video entries to a poster + QR (the headless PDF browser cannot
        // embed a player). The Stream customer subdomain is read from env; absent
        // ⇒ fail closed (selectReportMedia degrades video → image, never a
        // fabricated subdomain). appBaseUrl is the request origin for the QR deep
        // link.
        const streamCustomerSubdomain = c.env.STREAM_CUSTOMER_SUBDOMAIN ?? '';
        const appBaseUrl = new URL(c.req.url).origin;
        // R2 video serve base: PDF consumes only the poster JPEG (render-token);
        // web viewer fetches clips, tenant-guarded by the pool-row lookup.
        const data = await c.var.services.inspection.getReportData(id, tenantId, makePhotoUrl, {
            isPdf: renderMode,
            streamCustomerSubdomain,
            appBaseUrl,
            r2BaseUrl: `/api/inspections/${id}/media/video`,
        });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(reportPhotoRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { key, token, download, render, w } = c.req.valid('query');
        let tenantId = await resolveClientTenant(c, token, id);
        let renderMode = false;
        let ownerPreview = false;
        if (!tenantId && render) {
            const r = await resolveRenderAccess(render, id, c.env.JWT_SECRET);
            if (r) {
                const db = drizzle(c.env.DB);
                const row = await db.select({ tenantId: inspections.tenantId })
                    .from(inspections).where(eq(inspections.id, id)).get();
                if (row) { tenantId = row.tenantId; renderMode = true; }
            }
        }
        // Owner-session preview — same fallback as the report data route so the
        // owner's tokenless preview can load its photos (the key is re-checked
        // against this tenant + inspection below).
        if (!tenantId) { tenantId = await resolveOwnerPreview(c); ownerPreview = !!tenantId; }
        if (!tenantId) return c.notFound();
        const photoGate = await drizzle(c.env.DB)
            .select({ reportStatus: inspections.reportStatus })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!publicReportAccessAllowed({ renderMode, ownerPreview, reportStatus: photoGate?.reportStatus })) {
            return c.notFound();
        }
        if (!c.env.PHOTOS) return c.notFound();
        // Ownership: keys are `${tenantId}/inspections/${inspectionId}/...` — reject
        // anything outside the token's tenant + the requested inspection.
        if (!key.startsWith(`${tenantId}/inspections/${id}/`)) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();
        const width = w ? Math.min(Math.max(parseInt(w, 10) || 0, 16), 2000) : 0;
        const images = (c.env as unknown as { IMAGES?: {
            input(s: ReadableStream): { transform(o: { width: number }): { output(o: { format: string }): Promise<{ response(): Response }> } };
        } }).IMAGES;
        if (width > 0 && images && obj.body) {
            try {
                const out = await images.input(obj.body).transform({ width }).output({ format: 'image/webp' });
                const r = out.response();
                const h = new Headers(r.headers);
                h.set('Cache-Control', 'private, max-age=300');
                return new Response(r.body, { status: 200, headers: h });
            } catch (err) {
                logger.warn('[photo] thumbnail transform failed — serving original', { key, width, error: String(err) });
                const orig = await c.env.PHOTOS.get(key);
                if (orig) {
                    const hh = new Headers();
                    hh.set('Content-Type', orig.httpMetadata?.contentType || 'application/octet-stream');
                    hh.set('Cache-Control', 'private, max-age=300');
                    return new Response(orig.body, { status: 200, headers: hh });
                }
                return c.notFound();
            }
        }
        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', contentDisposition(obj.customMetadata?.originalName, download === '1'));
        headers.set('Cache-Control', 'private, max-age=300');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    })
    .openapi(reportPdfDownloadRoute, async (c) => {
        const { tenant, id } = c.req.valid('param');
        const { token, type } = c.req.valid('query');
        const reportType = type ?? 'full';

        // Auth: portal token + legacy agent-view-token bridge only.
        // No owner-preview, no render-token acceptance — this is a public
        // client-facing endpoint; the handler mints its own render token for
        // the headless renderer below.
        const tenantId = await resolveClientTenant(c, token, id);
        if (!tenantId) return c.notFound();

        if (!c.env.BROWSER || !c.env.PHOTOS) {
            return c.json({ success: false as const, error: { code: 'PDF_UNAVAILABLE', message: 'PDF rendering is not configured on this deployment.' } }, 503);
        }

        const db = drizzle(c.env.DB);
        const insp = await db
            .select({ status: inspections.status, reportStatus: inspections.reportStatus, dataVersion: inspections.dataVersion })
            .from(inspections)
            .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
            .get();
        if (!insp) return c.notFound();
        // Publish gate: this is a pure client-facing endpoint (no owner-preview, no
        // render token), so block whenever the report is not currently published.
        if (!publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: insp.reportStatus })) {
            return c.json({ success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } }, 403);
        }
        // Everyday download always tracks current content (versionNumber: null →
        // content-hash cache, renders live data). Frozen per-version PDFs are only
        // served from the verify page via GET /api/public/verify/report/:token/pdf.
        const reportUrl = await buildRenderReportUrl(getBookingHost(c), tenant, id, c.env.JWT_SECRET);
        const contentHash = await c.var.services.inspection.getReportContentHash(id, tenantId);
        const record = await c.var.services.reportPdf.getOrRender(id, tenantId, reportType, {
            reportUrl, contentHash, versionNumber: null,
        });
        const obj = await c.var.services.reportPdf.streamPdf(record);
        if (!obj) return c.notFound();

        const filename = `report-${id}${reportType === 'summary' ? '-summary' : ''}.pdf`;
        return new Response(obj.body, { status: 200, headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${filename}"`,
            'Cache-Control': 'private, max-age=300',
        } });
    })
    .route('/', publicInspectorProfileRoutes)
    .openapi(invoiceRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
        const inv = await c.var.services.invoice.findByInspectionId(tenantId, id);
        if (!inv) return c.json({ success: true as const, data: null }, 200);
        // A-10 — ship the tenant brand with the invoice so the public pay page
        // renders the inspector's branding (no tenant slug in /invoice/:id URLs).
        const brand = await c.var.services.branding.getBrand(tenantId);
        return c.json({ success: true as const, data: { ...inv, brand } }, 200);
    })
    .openapi(payIntentRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);

        // Bring-your-own-keys: the tenant's Stripe secret + publishable key are
        // merged into c.env from their encrypted secrets. No keys → graceful 503
        // (the pay panel shows the "contact your inspector" fallback).
        const env = c.env;
        const secretKey = env.STRIPE_SECRET_KEY;
        const publishableKey = env.STRIPE_PUBLISHABLE_KEY;
        if (!secretKey || !publishableKey) {
            return c.json({ success: false as const, error: { code: 'STRIPE_NOT_CONFIGURED', message: 'Online payment is not set up for this inspector.' } }, 503);
        }

        const inv = await c.var.services.invoice.findByInspectionId(tenantId, id);
        if (!inv) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Invoice not found' } }, 404);

        try {
            const { StripeService } = await import('../services/stripe.service');
            const svc = new StripeService(secretKey);
            const { clientSecret } = await svc.createPaymentIntent(
                { id: inv.id, amountCents: inv.amountCents, inspectionId: inv.inspectionId, status: inv.status, paidAt: inv.paidAt },
                // Phase B — charge in the invoice's snapshot currency (Stripe lowercases,
                // e.g. 'cad'), not a hardcoded USD, so the charge matches the billed amount.
                { tenantId, currency: inv.currency, descriptionPrefix: 'Inspection invoice' },
            );
            return c.json({ success: true as const, data: { clientSecret, publishableKey, amountCents: inv.amountCents } }, 200);
        } catch (err) {
            if (err instanceof InvoiceNotPayableError) {
                return c.json({ success: false as const, error: { code: 'INVOICE_NOT_PAYABLE', message: err.message } }, 409);
            }
            logger.error('Stripe pay-intent failed', { inspectionId: id.slice(0, 8) }, err instanceof Error ? err : undefined);
            return c.json({ success: false as const, error: { code: 'STRIPE_ERROR', message: 'Payment could not be started. Please try again.' } }, 503);
        }
    })
    .openapi(observeRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { token } = c.req.valid('query');
        const access = await resolveObserverAccess(c.var.services.observerLink, token, id);
        if (!access) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Inspection not found' } }, 404);
        const data = await c.var.services.inspection.getObserveProgress(id, access.tenantId);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(reportGateRoute, async (c) => {
        const { tenant, id } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
        const gate = await c.var.services.inspection.getReportGate(id, tenantId, tenant, c.var.services.agreement);
        return c.json({ success: true as const, data: gate }, 200);
    });

export type PublicReportApi = typeof publicReportRoutes;

export default publicReportRoutes;
