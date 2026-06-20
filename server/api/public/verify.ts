import { createRoute, z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspections, reportVersions } from '../../lib/db/schema';
import { createApiRouter } from '../../lib/openapi-router';
import { withMcpMetadata } from '../../lib/route-metadata-standards';
import { createApiResponseSchema } from '../../lib/validations/shared.schema';
import { loadVerifyData, loadReportVerifyData } from '../../lib/verify-data';
import { buildRenderReportUrl } from '../../lib/public-urls';
import { getBookingHost, resolveTenantSlug } from '../../lib/url';
import { isReportPublished } from '../../lib/status/report-status';

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

export const publicVerifyRoutes = createApiRouter()
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
    });

export default publicVerifyRoutes;
