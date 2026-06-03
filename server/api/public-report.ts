import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { ReportDataResponseSchema } from '../lib/validations/inspection.schema';
import { resolvePortalAccess, resolveObserverAccess } from '../lib/public-access';
import { loadVerifyData } from '../lib/verify-data';
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

// Public invoice for the report-gate "Pay invoice" CTA (by inspection id;
// tenant resolves from slug). The id is unguessable; tenant-scoped query.
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
    primaryColor: z.string(),
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
const VerifyResponseSchema = z.object({
    envelopeId: z.string(),
    documentTitle: z.string().nullable(),
    clientName: z.string().nullable(),
    clientEmail: z.string().nullable(),
    chainValid: z.boolean(),
    chainReason: z.string().nullable(),
    keyFingerprint: z.string().nullable(),
    keyAlgorithm: z.string(),
    eventCount: z.number(),
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
                clientEmail: data.reqRow.clientEmail,
                chainValid: data.verify.valid,
                chainReason: data.verify.valid ? null : (data.verify.reason as string),
                keyFingerprint: data.pubKey?.fingerprint ?? null,
                keyAlgorithm: 'Ed25519',
                eventCount: data.auditRows.length,
            },
        }, 200);
    })
    .openapi(reportRoute, async (c) => {
        const { id } = c.req.valid('param');
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
        const data = await c.var.services.inspection.getReportData(id, tenantId);
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
        const gate = await c.var.services.inspection.getReportGate(id, tenantId, tenant);
        return c.json({ success: true as const, data: gate }, 200);
    });

export type PublicReportApi = typeof publicReportRoutes;

export default publicReportRoutes;
