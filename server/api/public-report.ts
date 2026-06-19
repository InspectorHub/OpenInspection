import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { tenants, inspections, reportVersions } from '../lib/db/schema';
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
import { loadVerifyData, loadReportVerifyData } from '../lib/verify-data';
import { InvoiceNotPayableError } from '../lib/stripe-helpers';
import { logger } from '../lib/logger';
import { buildRenderReportUrl } from '../lib/public-urls';
import { getBookingHost, resolveTenantSlug } from '../lib/url';
import { publicReportAccessAllowed } from '../lib/report-access';
import { isReportPublished } from '../lib/status/report-status';

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
            notPublished: z.boolean(),
        })) } }, description: 'Verification result' },
        404: { description: 'Token not found' },
    },
    operationId: 'getPublicReportVerify',
    description: 'Public, no-login verification of a published report version: recomputes the content hash, verifies the Ed25519 signature, and checks the prev_hash chain.',
}, { scopes: [], tier: 'extended' }));

// #layer2 — frozen per-version PDF download for the public verifier page.
// Token resolves to a report_versions row → frozen archived PDF keyed by
// (inspectionId, type='full', versionNumber). If the frozen PDF hasn't been
// rendered yet (e.g. publish predated the pipeline), it renders once on-demand
// and stores it with versionNumber so subsequent hits are instant.
const reportVerifyPdfRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/verify/report/{token}/pdf',
    tags: ['public'],
    summary: 'Download the frozen archived PDF for a verified report version',
    request: { params: z.object({ token: z.string().describe('report_versions verification token') }) },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any().describe('Frozen archived PDF bytes') } }, description: 'Archived PDF' },
        404: { description: 'Token invalid or PDF not available' },
        503: { description: 'PDF rendering not configured on this deployment' },
    },
    operationId: 'getPublicReportVerifyPdf',
    description: 'Public, no-login download of the immutable archived PDF for a specific published report version. Identified by the report_versions verification token (same token as the verifier page). Rendered once on-demand and cached forever by version number.',
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
            notPublished: data.notPublished,
        } }, 200);
    })
    .openapi(reportVerifyPdfRoute, async (c) => {
        const { token } = c.req.valid('param');
        // Resolve token → report_versions row to get tenantId + versionNumber.
        // loadReportVerifyData only returns inspectionId from verifyByToken, so
        // we query the row directly for the tenantId we need.
        const db = drizzle(c.env.DB);
        const versionRow = await db.select({
            tenantId:      reportVersions.tenantId,
            inspectionId:  reportVersions.inspectionId,
            versionNumber: reportVersions.versionNumber,
            contentHash:   reportVersions.contentHash,
        }).from(reportVersions).where(eq(reportVersions.verificationToken, token)).get();
        if (!versionRow) return c.notFound();

        const { tenantId, inspectionId, versionNumber, contentHash } = versionRow;

        // Publish gate: the frozen archived PDF is a public client artifact — refuse
        // while the report is not currently published (re-publishing restores it).
        const inspRow = await db.select({ reportStatus: inspections.reportStatus })
          .from(inspections)
          .where(and(eq(inspections.id, inspectionId), eq(inspections.tenantId, tenantId)))
          .get();
        if (!isReportPublished(inspRow?.reportStatus)) {
          return c.json({ success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } }, 403);
        }

        if (!c.env.BROWSER || !c.env.PHOTOS) {
            return c.json({ success: false as const, error: { code: 'PDF_UNAVAILABLE', message: 'PDF rendering is not configured on this deployment.' } }, 503);
        }

        // Check if we already have a frozen PDF for this exact version.
        // getOrRender will return cached row on content-hash hit; on miss it
        // renders once and stores with versionNumber so subsequent hits are instant.
        const tenantSlug = await resolveTenantSlug(c, tenantId);
        const reportUrl = await buildRenderReportUrl(getBookingHost(c), tenantSlug, inspectionId, c.env.JWT_SECRET);

        // Use contentHash from the snapshot row if available; fall back to live hash
        // so even legacy rows (no contentHash) get a rendered PDF.
        const hash = contentHash ?? await c.var.services.inspection.getReportContentHash(inspectionId, tenantId);
        const footer = await c.var.services.inspection.getReportPdfFooterContext(inspectionId, tenantId);

        const record = await c.var.services.reportPdf.getOrRender(inspectionId, tenantId, 'full', {
            reportUrl,
            contentHash: hash,
            versionNumber,
            footer,
        });
        const obj = await c.var.services.reportPdf.streamPdf(record);
        if (!obj) return c.notFound();

        return new Response(obj.body, { status: 200, headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="report-v${versionNumber}.pdf"`,
            'Cache-Control': 'public, max-age=31536000, immutable',
        } });
    })
    .openapi(reportRoute, async (c) => {
        const { tenant, id } = c.req.valid('param');
        const { token, render } = c.req.valid('query');
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            // Bridge: existing customer share links carry the KV agent-view-token
            // (`?view=agent&token=`) until persistent per-recipient token issuance
            // is wired (see plan 2026-06-01-core-esign-redesign). Validate it the
            // same way: token must resolve to THIS inspection; tenantId from the token.
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
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
        const data = await c.var.services.inspection.getReportData(id, tenantId, makePhotoUrl, {
            isPdf: renderMode,
            streamCustomerSubdomain,
            appBaseUrl,
        });
        return c.json({ success: true as const, data }, 200);
    })
    .openapi(reportPhotoRoute, async (c) => {
        const { id } = c.req.valid('param');
        const { key, token, download, render, w } = c.req.valid('query');
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
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
        // Ownership: keys are `${tenantId}/${inspectionId}/...` — reject anything
        // outside the token's tenant + the requested inspection.
        if (!key.startsWith(`${tenantId}/${id}/`)) return c.notFound();
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
        let tenantId = (await resolvePortalAccess(c.var.services.portalAccess, token, id))?.tenantId ?? null;
        if (!tenantId && token) {
            const legacy = await c.var.services.inspection.resolveAgentViewToken(token);
            if (legacy && legacy.inspectionId === id) tenantId = legacy.tenantId;
        }
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
