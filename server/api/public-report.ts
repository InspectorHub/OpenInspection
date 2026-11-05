import { createRoute, z } from '@hono/zod-openapi';
import { eq, and } from 'drizzle-orm';
import { inspections, tenants } from '../lib/db/schema';
import { resolveRenderAccess } from '../lib/render-token';
import { createApiRouter } from '../lib/openapi-router';
import { mounted, type ApiOf } from '../lib/api-schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { createApiResponseSchema } from '../lib/validations/shared.schema';
import { resolvePortalAccess, resolveOwnerPreview, classifyPortalAccess } from '../lib/public-access';
import { resolveClientActor } from '../lib/portal-client-actor';
import { recordReportView, readReportViewCountingEnabled } from '../lib/report-views';
import publicViewTrackingRoutes, { viewTrackingRouteConfigs } from './public/view-tracking';
// Re-exported for existing importers (tests); both now live in lib/.
export { resolveOwnerPreviewToken } from '../lib/public-access';
export { resolveRenderAccess } from '../lib/render-token';
import { InvoiceNotPayableError } from '../lib/stripe-helpers';
import { logger } from '../lib/logger';
import { buildRenderReportUrl } from '../lib/public-urls';
import { getBookingHost, getBaseUrl } from '../lib/url';
import { publicReportAccessAllowed, shouldPinLatestPublished } from '../lib/report-access';
import { resolveClientTenant, releaseGateFor, authorizeReportMedia, companySlugFor } from '../lib/report-link-access';
import publicReportVideoRoutes, { reportVideoRouteConfigs } from './public/report-video';
import publicVerifyRoutes, { publicVerifyRouteConfigs } from './public/verify';
import publicInspectorProfileRoutes, { publicInspectorProfileRouteConfigs } from './public/inspector-profile';
import { PublicInvoiceBodySchema, PUBLIC_INVOICE_FIELDS } from '../lib/validations/invoice.schema';
import { getDrizzle } from '../lib/route-helpers';
import { readCourtesyTranslationForReport } from '../lib/translation/read-for-report';
import { projectReportForLink } from '../lib/report-link-response';
import { projectFields } from '../lib/response-projection';
import { projectCredentialBadgeUrls, respondRelativizedJson } from '../lib/report-link-keys';
import { serveReportPhoto } from '../lib/report-link-photo';
import { COURTESY_TRANSLATION_LOCALE, PublicReportResponseSchema } from '../lib/validations/courtesy-translation.schema';

/**
 * Public, no-login portal endpoints (`/api/public/*`). Access is gated by the
 * persistent per-(recipient, order) portal token (a tokenized-link
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
        200: { content: { 'application/json': { schema: PublicReportResponseSchema } }, description: 'Report data' },
        404: { description: 'Not found, or the token names nothing' },
        410: { description: 'The link was valid but has expired or been revoked (IA-36 ⑨) — code REPORT_LINK_EXPIRED / REPORT_LINK_REVOKED' },
    },
    operationId: 'getPublicReport',
    description: 'Public, no-login report data resolved via a persistent portal token (a tokenized link). 404 when the token is missing or names nothing; 410 when a real link has expired or been revoked, so the page can explain what happened instead of showing a not-found.',
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
            key: z.string().describe('Photo key as a report response states it, relative to the company: `inspections/<inspectionId>/...` (a credential badge: `credentials/<id>/logo-...`). The full form `<companyId>/inspections/<inspectionId>/...` is also accepted, so links issued earlier keep working.'),
            token: z.string().optional().describe('Persistent portal access token.'),
            download: z.string().optional().describe('Set to "1" to force an attachment download named after the original file.'),
            render: z.string().optional().describe('Server-minted render token (headless PDF only).'),
            w: z.string().optional().describe('Optional max width in px for an on-the-fly WebP thumbnail; omitted serves the original.'),
            v: z.string().optional().describe('Badge render variant for a credential badge key: email | reportSignature | reportCover. Omitted or unrecognised serves the original, never an error.'),
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

/**
 * IA-34 — the invoice + pay-intent pair is gated by `resolveClientActor`, the
 * SAME guard the client documents/messages routes use: a live per-recipient
 * portal `?token=` for THIS inspection, or the `__Host-portal_session` cookie,
 * and only for `client` / `co_client` role kinds. The inspection id is an
 * identifier, never a credential — a bare id now 401s on both routes.
 *
 * The actor's tenantId is AUTHORITATIVE (it comes off the token/grant row).
 * The tenant-by-inspection-id router still resolves a tenant for these paths
 * (that is what loads the tenant's own Stripe keys into `c.env`), so the
 * pay-intent handler asserts the two agree before charging anything.
 */
// Shape lives in validations/invoice.schema.ts — both public pay surfaces in
// `app/` derive their wire type from it, and `app/` may only import server/lib.
const PublicInvoiceSchema = PublicInvoiceBodySchema.nullable();

const invoiceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{id}/invoice',
    tags: ['public'],
    summary: 'Public invoice for an inspection (pay-link landing)',
    request: {
        params: z.object({ id: z.string().describe('Inspection id the invoice belongs to.') }),
        query: z.object({
            token: z.string().optional().describe('Persistent per-recipient portal access token (or present the __Host-portal_session cookie instead).'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PublicInvoiceSchema) } }, description: 'Invoice (or null if none)' },
        401: { description: 'No live client/co_client grant for this inspection' },
    },
    operationId: 'getPublicInvoice',
    description: "Public, no-login invoice for an inspection, gated by the recipient's portal token (?token=) or the unified-portal session cookie. Only client/co_client grants are accepted; tenantId comes from the resolved grant, never the URL.",
}, { scopes: [], tier: 'extended' }));

// Public Stripe PaymentIntent mint for the invoice pay-panel (bring-your-own-keys:
// the tenant's OWN Stripe secret key is loaded per-request into c.env by the
// integration-secrets middleware). Returns the client secret + the tenant's
// publishable key so the browser can mount Stripe Elements inline.
export const PayIntentSchema = z.object({
    clientSecret: z.string(),
    publishableKey: z.string(),
    amountCents: z.number(),
});

const payIntentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{id}/pay-intent',
    tags: ['public'],
    summary: 'Start a Stripe card payment for an inspection invoice',
    request: {
        params: z.object({ id: z.string().describe('Inspection id the invoice belongs to.') }),
        query: z.object({
            token: z.string().optional().describe('Persistent per-recipient portal access token (or present the __Host-portal_session cookie instead).'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(PayIntentSchema) } }, description: 'PaymentIntent client secret + publishable key' },
        401: { description: 'No live client/co_client grant for this inspection' },
        404: { description: 'Invoice not found' },
        409: { description: 'Invoice is not payable (already paid / $0)' },
        503: { description: 'Stripe is not configured for this tenant, or the charge could not be started' },
    },
    operationId: 'createPublicPayIntent',
    description: "Mints a Stripe PaymentIntent for the inspection's invoice using the tenant's own Stripe keys. Gated by the recipient's portal token (?token=) or the unified-portal session cookie — client/co_client grants only.",
}, { scopes: [], tier: 'extended' }));

// Public report-gate (③-A.2). The "report blocked, here's why + CTA" page,
// resolved by tenant slug + id (no token — pre-report). Returns only
// non-sensitive gate fields (reason + branding + inspector contact + amount).
export const ReportGateResponseSchema = z.object({
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
        query: z.object({
            token: z.string().optional().describe('Persistent portal access token of the recipient; without it the payload carries no signer link.'),
        }),
    },
    responses: {
        200: { content: { 'application/json': { schema: createApiResponseSchema(ReportGateResponseSchema) } }, description: 'Gate payload (or null when the report is not gated)' },
        404: { description: 'Tenant not resolved' },
    },
    operationId: 'getPublicReportGate',
    description: 'Public, no-login report-gate status resolved by tenant slug + inspection id. Returns the outstanding gate (agreement before payment) with branding, inspector contact, and amount due — or null when the report is not gated.',
}, { scopes: [], tier: 'extended' }));

const app = createApiRouter();
app.route('/', publicVerifyRoutes);
app.route('/', publicViewTrackingRoutes);
app.route('/', publicReportVideoRoutes);
app.openapi(reportRoute, async (c) => {
    const { tenant, id } = c.req.valid('param');
    const { token, render } = c.req.valid('query');
    const clientGrant = await resolveClientTenant(c, token, id);
    let tenantId = clientGrant?.tenantId ?? null;
    // Render-token path: headless CF Browser Rendering cannot carry a session
    // cookie or portal token; trusted server flows mint a short-TTL render token
    // and pass it as `?render=`. Resolve tenantId from the inspection row so the
    // headless browser can load the full report without any user credential.
    let renderMode = false;
    // A version named INSIDE the signed render token, when the caller is
    // materialising a specific published version (the verify page's frozen
    // PDF). Never read from the query string: a link holder who could append
    // `&v=1` would be asking the renderer for a version they were never sent.
    let pinnedVersion: number | undefined;
    if (!tenantId && render) {
        const r = await resolveRenderAccess(render, id, c.env.JWT_SECRET);
        if (r) {
            const db = getDrizzle(c);
            const row = await db.select({ tenantId: inspections.tenantId })
                .from(inspections).where(eq(inspections.id, id)).get();
            if (row) { tenantId = row.tenantId; renderMode = true; pinnedVersion = r.versionNumber; }
        }
    }
    // Owner-session preview: an authenticated tenant user (inspector/admin)
    // may preview their own report without a recipient token. Ownership of
    // THIS inspection is enforced by getReportData's tenant-scoped query.
    let ownerPreview = false;
    if (!tenantId) { tenantId = await resolveOwnerPreview(c); ownerPreview = !!tenantId; }

    // OPTION A — a delivered report renders what it froze.
    //
    // A recipient reading their link gets the latest PUBLISHED version's
    // snapshot, not live tables, so later changes to the inspector's
    // credentials do not alter an issued report that carries a signature and
    // an integrity hash.
    //
    // Three deliberate exclusions:
    //  - RENDER TOKEN already names its own version (above); it must keep
    //    it, because the verify page materialises one specific version.
    //  - OWNER PREVIEW stays LIVE. The owner is the author: preview exists
    //    to show work in progress, and pinning it would hide every edit made
    //    after the last publish. This is the plan's own split — "publish →
    //    snapshot; live/draft preview → read current state".
    //  - AN UNPUBLISHED report has no version row, so it resolves live by
    //    falling through with `pinnedVersion` still undefined.
    //
    // Server-derived, like the render token's: nothing here reads a version
    // from the query string, so a link holder still cannot ask for one.
    if (tenantId && shouldPinLatestPublished({ renderMode, ownerPreview, tokenPinnedVersion: pinnedVersion })) {
        const latest = await c.var.services.reportVersion.getLatestPublished(tenantId, id);
        if (latest) pinnedVersion = latest.versionNumber;
    }
    if (!tenantId) {
        // IA-36 ⑨ — distinguish "this link was taken offline" from "this link
        // never existed". The recipient was invited by us and the link died by
        // our policy, so they get a page that says so instead of a 404 that
        // implies they mistyped something. Only reached AFTER access was
        // already refused, and only for a token whose secret the caller is
        // already holding — a guessed token still gets the flat 404.
        const state = await classifyPortalAccess(c.var.services.portalAccess, token, id);
        if (state === 'expired' || state === 'revoked') {
            return c.json({
                success: false as const,
                error: {
                    code: state === 'expired' ? 'REPORT_LINK_EXPIRED' : 'REPORT_LINK_REVOKED',
                    message: 'This report link is no longer active.',
                },
            }, 410);
        }
        return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Report not found' } }, 404);
    }
    // Publish gate: client/token access is revoked while the report is not
    // published (owner-preview + render-token bypass — they may view drafts).
    const gateRow = await getDrizzle(c)
        .select({ reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    // `releaseGate` is the agreement or payment hold the client Hub reports; this endpoint applies it too, in addition to the published check.
    const releaseGate = await releaseGateFor(c.var.services, id, tenantId, renderMode || ownerPreview);
    if (!publicReportAccessAllowed({ renderMode, ownerPreview, reportStatus: gateRow?.reportStatus, releaseGate })) {
        return c.json(releaseGate
            ? { success: false as const, error: { code: 'REPORT_GATED', message: 'This report has not been released yet.' } }
            : { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } }, 403);
    }
    // OI #271 — delivery confirmation, after the publish gate (a blocked
    // request is not an open). Grant/renderMode/ownerPreview are resolved
    // here; only `x-oi-client-method` is relayed. Never throws.
    //
    // `countingEnabled` is the tenant's own decision and defaults to false
    // (a legitimate interest may not be a mask for processing
    // its supposed beneficiary cannot decline). A missing config row reads
    // as OFF, which is the same direction as the column default: a tenant
    // who has never opened the settings page has not opted in.
    // Read through the shared reader, which is also what decides whether the
    // delivery email may state that opens are recorded. Two readings of one
    // column is how the email came to describe processing this branch was
    // not doing.
    const countingEnabled = await readReportViewCountingEnabled(getDrizzle(c), tenantId);
    await recordReportView(getDrizzle(c), { tenantId, inspectionId: id }, {
        countingEnabled,
        accessTokenId: clientGrant?.accessTokenId ?? null, renderMode, ownerPreview,
        method: c.req.header('x-oi-client-method') ?? c.req.method,
        purpose: c.req.header('purpose'), secPurpose: c.req.header('sec-purpose'),
    });
    // Photo URLs: render mode carries the render token (no session cookie in the headless browser); owner preview needs no token
    // (the photo route accepts the owner's session). Every mode uses the public photo route, which takes the company-relative key.
    const tk = token ?? '';
    const makePhotoUrl = renderMode
        ? (key: string) => `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}&render=${encodeURIComponent(render!)}`
        : ownerPreview
            ? (key: string) => `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}`
            : (key: string) => `/api/public/report/${tenant}/${id}/photo?key=${encodeURIComponent(key)}&token=${encodeURIComponent(tk)}`;
    // Plan 7 — video media context. `renderMode` (the render-token/PDF path)
    // forces video entries to a poster + QR (the headless PDF browser cannot
    // embed a player). The Stream customer subdomain is read from env; absent
    // ⇒ fail closed (selectReportMedia degrades video → image, never a
    // fabricated subdomain). appBaseUrl is the request origin for the QR deep
    // link.
    const streamCustomerSubdomain = c.env.STREAM_CUSTOMER_SUBDOMAIN ?? '';
    const appBaseUrl = new URL(c.req.url).origin;
    // R2 video: the clip and poster are served by the report's own token-gated video routes, so the URLs carry the same proof the
    // photo URLs do (render token for the PDF renderer, none for an owner session, the portal token otherwise).
    const data = await c.var.services.inspection.getReportData(id, tenantId, makePhotoUrl, {
        isPdf: renderMode,
        streamCustomerSubdomain,
        appBaseUrl,
        r2BaseUrl: `/api/public/report/${tenant}/${id}/video`,
        r2Query: renderMode ? `render=${encodeURIComponent(render!)}` : ownerPreview ? '' : `token=${encodeURIComponent(tk)}`,
    }, pinnedVersion);
    // #23 — the courtesy translation, when one is stored AND still describes
    // this English. ⚠️ No tenant setting is read: production is gated,
    // consumption never is. See lib/translation/read-for-report.ts.
    const courtesyTranslation = await readCourtesyTranslationForReport(
        { db: c.env.DB, inspection: c.var.services.inspection, translations: c.var.services.reportTranslation },
        { tenantId, inspectionId: id, locale: COURTESY_TRANSLATION_LOCALE, data, versionNumber: pinnedVersion },
    );
    // The translation reader above got the report as built; the response carries only the report link's fields,
    // with storage keys stated relative to the company (the photo route puts the company back).
    return respondRelativizedJson(c, { success: true as const, data: projectCredentialBadgeUrls(projectReportForLink(data), tenantId, makePhotoUrl), courtesyTranslation }, tenantId); // projection-allow: courtesyTranslation is the stored translation payload declared by CourtesyTranslationPayloadSchema, or null
});
app.openapi(reportPhotoRoute, async (c) => {
    const { id } = c.req.valid('param');
    const { key, token, download, render, w, v } = c.req.valid('query');
    // Same proof and the same two gates as the report data: a gate that holds the report but serves its photographs is not a gate.
    const access = await authorizeReportMedia(c, id, { token, render });
    if (!access) return c.notFound();
    // Ownership is checked on the full key inside (report-link-keys.ts): the request may name it relative to the company
    // (what a response carries) or in full (links issued earlier).
    const photo = await serveReportPhoto(c.env, { key, width: w, download: download === '1', variant: v }, access.tenantId, id);
    return photo ?? c.notFound();
});
app.openapi(reportPdfDownloadRoute, async (c) => {
    const { tenant, id } = c.req.valid('param');
    const { token, type } = c.req.valid('query');
    const reportType = type ?? 'full';

    // Auth: portal token + legacy agent-view-token bridge only.
    // No owner-preview, no render-token acceptance — this is a public
    // client-facing endpoint; the handler mints its own render token for
    // the headless renderer below.
    const tenantId = (await resolveClientTenant(c, token, id))?.tenantId ?? null;
    if (!tenantId) return c.notFound();

    if (!c.env.BROWSER || !c.env.PHOTOS) {
        return c.json({ success: false as const, error: { code: 'PDF_UNAVAILABLE', message: 'PDF rendering is not configured on this deployment.' } }, 503);
    }

    const db = getDrizzle(c);
    const insp = await db
        .select({ status: inspections.status, reportStatus: inspections.reportStatus })
        .from(inspections)
        .where(and(eq(inspections.id, id), eq(inspections.tenantId, tenantId)))
        .get();
    if (!insp) return c.notFound();
    // Publish gate: this is a pure client-facing endpoint (no owner-preview, no
    // render token), so block whenever the report is not currently published.
    // Same two gates. This is the pure client-facing download; the headless
    // renderer reaches the report through its own render token above, so
    // gating here does not block the PDF from being BUILT, only from being
    // handed to a client who has not cleared the hold.
    const pdfReleaseGate = await releaseGateFor(c.var.services, id, tenantId, false);
    if (!publicReportAccessAllowed({ renderMode: false, ownerPreview: false, reportStatus: insp.reportStatus, releaseGate: pdfReleaseGate })) {
        // Same two meanings as the payload door above. Answering NOT_PUBLISHED
        // for a held report tells a client who owes money that their inspector
        // has not finished — the wrong fact, and it points them at the wrong
        // person to fix it.
        return c.json(pdfReleaseGate
            ? { success: false as const, error: { code: 'REPORT_GATED', message: 'This report has not been released yet.' } }
            : { success: false as const, error: { code: 'NOT_PUBLISHED', message: 'This report is not published.' } }, 403);
    }
    // The client's PDF is the PUBLISHED version, like the report page they read: the render is pinned to that version through the
    // signed render token, and the cache key is the version's own content hash, so a later edit of the live tables cannot change
    // what a client downloads. The same version is also what the verify page serves, so the two share one stored render. A report
    // with no version row (not yet frozen) keeps the live hash.
    // The report page is frozen at that same version (getReportData overlays the snapshot's findings and units), so the
    // render, the page and the cache key all describe one document.
    const latest = await c.var.services.reportVersion.getLatestPublished(tenantId, id);
    const versionNumber = latest?.versionNumber ?? null;
    // The slug in the render URL comes from the company's own row. The URL segment is the caller's text: it is not a path the
    // headless browser (which carries a render token) may be steered by.
    const slug = await companySlugFor(c, tenantId, tenant);
    const reportUrl = await buildRenderReportUrl(getBookingHost(c), slug, id, c.env.JWT_SECRET, versionNumber ?? undefined);
    const contentHash = latest?.contentHash
        ?? await c.var.services.inspection.getReportContentHash(id, tenantId, undefined, null, versionNumber ?? undefined);
    const footer = await c.var.services.inspection.getReportPdfFooterContext(id, tenantId);
    const record = await c.var.services.reportPdf.getOrRender(id, tenantId, reportType, {
        reportUrl, contentHash, versionNumber, footer,
    });
    const obj = await c.var.services.reportPdf.streamPdf(record);
    if (!obj) return c.notFound();

    const filename = `report-${id}${reportType === 'summary' ? '-summary' : ''}.pdf`;
    return new Response(obj.body, { status: 200, headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, max-age=300',
    } });
});
app.route('/', publicInspectorProfileRoutes);
app.openapi(invoiceRoute, async (c) => {
    const { id } = c.req.valid('param');
    // IA-34 — client/co_client grant required (?token= or portal session).
    const actor = await resolveClientActor(c, id);
    if (!actor) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'Not authorized for this inspection' } }, 401);
    const tenantId = actor.tenantId;
    const inv = await c.var.services.invoice.findByInspectionId(tenantId, id);
    if (!inv) return c.json({ success: true as const, data: null }, 200);
    // A-10 — ship the tenant brand with the invoice so the public pay page
    // renders the inspector's branding (no tenant slug in /invoice/:id URLs).
    const tenantRow = await getDrizzle(c).select({ slug: tenants.slug })
        .from(tenants).where(eq(tenants.id, tenantId)).get();
    const brand = await c.var.services.branding.getBrand(tenantId, {
        slug: tenantRow?.slug ?? null,
        baseUrl: getBaseUrl(c),
    });
    // IA-44 — and the slug, so the page can hand off to the slug-keyed Hub
    // once payment succeeds.
    // Project through the declared shape: `PublicInvoiceBodySchema.parse` keeps only declared fields, so a column added later does not
    // reach the response.
    // A missing description or a new brand field must not turn the pay page into a 500, so the nested shapes are normalized first.
    // Every other declared field is a plain string or number from the invoice row (createdAt goes through safeISODate).
    //
    // `brand` in particular crosses a service boundary, so its shape is not
    // this file's to guarantee: name the fields the payer's page needs and
    // let anything else fall away, rather than trusting the whole object.
    const lineItems = (inv.lineItems ?? []).map((li) => ({
        description: String(li?.description ?? ''),
        amountCents: Number(li?.amountCents ?? 0),
    }));
    const brandView = {
        companyName: brand?.companyName ?? null,
        primaryColor: brand?.primaryColor ?? null,
        logoUrl: brand?.logoUrl ?? null,
        defaultTimezone: brand?.defaultTimezone ?? 'UTC',
        legalName: brand?.legalName ?? '', defaultLocale: brand?.defaultLocale ?? 'en-US', dateFormat: brand?.dateFormat ?? 'us', timeFormat: brand?.timeFormat ?? '12h',
        supportEmail: brand?.supportEmail ?? null,
        companyPhone: brand?.companyPhone ?? null,
        privacyUrl: brand?.privacyUrl ?? null,
        termsUrl: brand?.termsUrl ?? null,
    };
    const view = PublicInvoiceBodySchema.parse({ ...projectFields(inv, PUBLIC_INVOICE_FIELDS), lineItems, brand: brandView, tenantSlug: tenantRow?.slug ?? null });
    return c.json({ success: true as const, data: view }, 200);
});
app.openapi(payIntentRoute, async (c) => {
    const { id } = c.req.valid('param');
    // IA-34 — client/co_client grant required (?token= or portal session).
    const actor = await resolveClientActor(c, id);
    if (!actor) return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'Not authorized for this inspection' } }, 401);
    const tenantId = actor.tenantId;
    // The Stripe keys in c.env were injected for the ROUTED tenant. Both
    // resolve from the same inspection, so a mismatch means the routing and
    // the grant disagree — refuse rather than charge with foreign keys.
    const routedTenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
    if (routedTenantId && routedTenantId !== tenantId) {
        return c.json({ success: false as const, error: { code: 'UNAUTHORIZED', message: 'Not authorized for this inspection' } }, 401);
    }

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
        // projection-allow: the client secret and publishable key of this invoice's payment intent, which the payment form needs
        return c.json({ success: true as const, data: { clientSecret, publishableKey, amountCents: inv.amountCents } }, 200);
    } catch (err) {
        if (err instanceof InvoiceNotPayableError) {
            return c.json({ success: false as const, error: { code: 'INVOICE_NOT_PAYABLE', message: err.message } }, 409);
        }
        logger.error('Stripe pay-intent failed', { inspectionId: id.slice(0, 8) }, err instanceof Error ? err : undefined);
        return c.json({ success: false as const, error: { code: 'STRIPE_ERROR', message: 'Payment could not be started. Please try again.' } }, 503);
    }
});
app.openapi(reportGateRoute, async (c) => {
    const { tenant, id } = c.req.valid('param');
    const tenantId = (c.get('resolvedTenantId') || c.get('tenantId')) as string | null;
    if (!tenantId) return c.json({ success: false as const, error: { code: 'NOT_FOUND', message: 'Not found' } }, 404);
    // The signer link in the payload is the caller's own and only for a caller holding a portal token for THIS inspection.
    const { token } = c.req.valid('query');
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, id);
    const recipientEmail = grant && grant.tenantId === tenantId ? grant.recipientEmail : null;
    const gate = await c.var.services.inspection.getReportGate(id, tenantId, tenant, c.var.services.agreement, recipientEmail);
    return c.json({ success: true as const, data: gate }, 200); // projection-allow: getReportGate builds the typed gate the report page states (reason, labels, links)
});

/** Registration order, mounts included. Drives `PublicReportApi`; a test pins it to what `app` really registered. */
export const publicReportRouteParts = [
    mounted('/', publicVerifyRoutes, publicVerifyRouteConfigs),
    mounted('/', publicViewTrackingRoutes, viewTrackingRouteConfigs),
    mounted('/', publicReportVideoRoutes, reportVideoRouteConfigs),
    reportRoute,
    reportPhotoRoute,
    reportPdfDownloadRoute,
    mounted('/', publicInspectorProfileRoutes, publicInspectorProfileRouteConfigs),
    invoiceRoute,
    payIntentRoute,
    reportGateRoute,
] as const;

export type PublicReportApi = ApiOf<typeof publicReportRouteParts>;

export default app;
