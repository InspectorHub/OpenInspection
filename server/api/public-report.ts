import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { tenants } from '../lib/db/schema';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { ReportDataResponseSchema } from '../lib/validations/inspection.schema';
import { resolvePortalAccess, resolveObserverAccess } from '../lib/public-access';
import { contentDisposition } from '../lib/content-disposition';
import { loadVerifyData, loadReportVerifyData } from '../lib/verify-data';
import { InvoiceNotPayableError } from '../lib/stripe-helpers';
import { logger } from '../lib/logger';

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
        query: z.object({ token: z.string().optional().describe('Persistent portal access token.') }),
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
        }),
    },
    responses: {
        200: { content: { 'image/*': { schema: z.any() } }, description: 'Photo bytes' },
        404: { description: 'Not found or token invalid/expired' },
    },
    operationId: 'getPublicReportPhoto',
    description: 'Public, no-login inspection photo gated by the same portal token as the report data. 404 when the token is invalid or the key is outside the token\'s tenant + inspection.',
}, { scopes: [], tier: 'extended' }));

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
const PublicBrandSchema = z.object({
    siteName: z.string().nullable(),
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
    description: 'Public, no-login tenant branding (siteName / primaryColor / logoUrl) resolved by tenant slug. Powers the consistent brand overlay on profile, booking, report, and invoice surfaces.',
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

// Public invoice for the report-gate "Pay invoice" CTA (by inspection id;
// tenant resolves from slug). The id is unguessable; tenant-scoped query.
const PublicInvoiceSchema = z.object({
    id: z.string(),
    amountCents: z.number(),
    status: z.string(),
    createdAt: z.string().nullable().optional(),
    dueDate: z.string().nullable().optional(),
    clientName: z.string().nullable().optional(),
    lineItems: z.array(z.object({ description: z.string(), amountCents: z.number() })).optional(),
    brand: PublicBrandSchema.optional(),
}).nullable();

const invoiceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/r/{id}/invoice',
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
    path: '/r/{id}/pay-intent',
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

// Public e-sign verifier (Spec 5H P2, court-friendly). Reuses the raw siblings'
// loadVerifyData; this is the base JSON route the verify page consumes.
const VerifySignerSchema = z.object({
    name: z.string(),
    role: z.string(),
    status: z.string(),
    signedAt: z.string().nullable(),
    channel: z.string().nullable(),
});

const VerifyResponseSchema = z.object({
    envelopeId: z.string(),
    documentTitle: z.string().nullable(),
    clientName: z.string().nullable(),
    chainValid: z.boolean(),
    chainReason: z.string().nullable(),
    keyFingerprint: z.string().nullable(),
    keyAlgorithm: z.string(),
    eventCount: z.number(),
    // Track I-a — the pinned content snapshot ("what was signed") + its hash, and
    // the per-signer roster (no emails — privacy). Snapshot is null on
    // pre-feature envelopes signed before snapshots were introduced.
    contentSnapshot: z.string().nullable(),
    contentHash: z.string().nullable(),
    signers: z.array(VerifySignerSchema),
});

const verifyRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/verify/{envelopeId}',
    tags: ['public'],
    summary: 'Public e-signature verification (court-friendly)',
    request: { params: z.object({ envelopeId: z.string().describe('Signature envelope identifier to verify') }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(VerifyResponseSchema) } }, description: 'Verification result' },
        404: { description: 'Envelope not found' },
    },
    operationId: 'getPublicVerify',
    description: 'Public, no-login signature-chain verification for a signed agreement envelope. Returns chain validity + key fingerprint for independent verification.',
}, { scopes: [], tier: 'extended' }));

// #120 — public report-version verifier (court-friendly). Recomputes the
// content hash, verifies the Ed25519 signature, and checks the prev_hash chain.
// Mirrors the e-sign verifier above; exposes no PII beyond a masked address.
const reportVerifyRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/verify/report/{token}',
    tags: ['public'],
    summary: 'Public report-version verification (court-friendly)',
    request: { params: z.object({ token: z.string().describe('report_versions verification token') }) },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(z.object({
            versionNumber: z.number(), isAmendment: z.boolean(), publishedAt: z.number(),
            contentHash: z.string().nullable(), keyFingerprint: z.string().nullable(),
            keyAlgorithm: z.string(), legacy: z.boolean(),
            hashValid: z.boolean(), signatureValid: z.boolean(), chainValid: z.boolean(),
            propertyAddressMasked: z.string(),
        })) } }, description: 'Verification result' },
        404: { description: 'Token not found' },
    },
    operationId: 'getPublicReportVerify',
    description: 'Public, no-login verification of a published report version: recomputes the content hash, verifies the Ed25519 signature, and checks the prev_hash chain.',
}, { scopes: [], tier: 'extended' }));

export const publicReportRoutes = createApiRouter()
    .openapi(verifyRoute, async (c) => {
        const { envelopeId } = c.req.valid('param');
        const data = await loadVerifyData(c, envelopeId);
        if (!data) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Envelope not found' } }, 404);
        return c.json({
            success: true as const,
            data: {
                envelopeId,
                documentTitle: data.agreement?.name ?? null,
                clientName: data.reqRow.clientName,
                // clientEmail deliberately NOT exposed — this is a public, no-auth
                // endpoint; the signer roster below is email-free for the same reason.
                chainValid: data.verify.valid,
                chainReason: data.verify.valid ? null : (data.verify.reason as string),
                keyFingerprint: data.pubKey?.fingerprint ?? null,
                keyAlgorithm: 'Ed25519',
                eventCount: data.auditRows.length,
                contentSnapshot: data.reqRow.contentSnapshot ?? null,
                contentHash: data.reqRow.contentHash ?? null,
                signers: data.signers.map((s) => ({
                    name: s.name,
                    role: s.role,
                    status: s.status,
                    signedAt: s.signedAt ? new Date(s.signedAt).toISOString() : null,
                    channel: s.channel ?? null,
                })),
            },
        }, 200);
    })
    .openapi(reportVerifyRoute, async (c) => {
        const { token } = c.req.valid('param');
        const data = await loadReportVerifyData(c, token);
        if (!data) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Token not found' } }, 404);
        return c.json({ success: true as const, data: {
            versionNumber: data.verify.versionNumber,
            isAmendment:   data.verify.isAmendment,
            publishedAt:   data.verify.publishedAt,
            contentHash:   data.verify.contentHash,
            keyFingerprint: data.verify.keyFingerprint,
            keyAlgorithm:  'Ed25519',
            legacy:        data.verify.legacy,
            hashValid:     data.verify.hashValid,
            signatureValid: data.verify.signatureValid,
            chainValid:    data.verify.chainValid,
            propertyAddressMasked: data.propertyAddressMasked,
        } }, 200);
    })
    .openapi(reportRoute, async (c) => {
        const { tenant, id } = c.req.valid('param');
        const { token } = c.req.valid('query');
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            // Bridge: existing customer share links carry the KV agent-view-token
            // (`?view=agent&token=`) until persistent per-recipient token issuance
            // is wired (see plan 2026-06-01-core-esign-redesign). Validate it the
            // same way: token must resolve to THIS inspection; tenantId from the token.
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
        if (!tenantId) {
            return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
        }
        // A-9: render photo URLs against the public token-scoped serve route so
        // the no-login viewer can fetch them (the default authed URL would 401).
        const tk = token ?? '';
        const makePhotoUrl = (key: string) =>
            `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(tk)}`;
        const data = await c.var.services.inspection.getReportData(id, tenantId, makePhotoUrl);
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(reportPhotoRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { key, token, download } = c.req.valid('query');
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
        if (!tenantId) return c.notFound();
        if (!c.env.PHOTOS) return c.notFound();
        // Ownership: keys are `${tenantId}/${inspectionId}/...` — reject anything
        // outside the token's tenant + the requested inspection.
        if (!key.startsWith(`${tenantId}/${id}/`)) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();
        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', contentDisposition(obj.customMetadata?.originalName, download === '1'));
        headers.set('Cache-Control', 'private, max-age=300');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    })
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
        if (!key.startsWith('branding/')) return c.notFound();
        const obj = await c.env.PHOTOS.get(key);
        if (!obj) return c.notFound();
        const headers = new Headers();
        headers.set('Content-Type', obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Cache-Control', 'public, max-age=3600');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    })
    .openapi(invoiceRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
        if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
        const inv = await c.var.services.invoice.findByInspectionId(tenantId, id);
        if (!inv) return c.json({ success: true as const, data: null }, 200);
        // A-10 — ship the tenant brand with the invoice so the public pay page
        // renders the inspector's branding (no tenant slug in /r/:id URLs).
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
        const env = c.env as unknown as Record<string, string | undefined>;
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
                { tenantId, descriptionPrefix: 'Inspection invoice' },
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
