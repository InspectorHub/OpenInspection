import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { r2Keys } from '../lib/r2-keys';
import { deliverableHeaders } from '../lib/deliverable-headers';

/**
 * Pure download helpers exported for unit testing. The OpenAPIHono route
 * handlers below are thin wrappers that pull tenantId from the JWT context
 * and forward to these.
 *
 * ⚠️ THREE helpers, three independent `r2.get` calls, no shared fetch layer.
 * Anything that has to be true of a served deliverable has to be true in all
 * three, and nothing in this file will tell you which one you missed — so the
 * rule itself lives in `server/lib/artifact-status.ts` and each helper reads
 * one answer from it through `deliverableHeaders`, which moved to
 * `server/lib/deliverable-headers.ts` once a fourth deliverable on another
 * route needed the same headers.
 */

export async function downloadAgreementPdf(
    d1: D1Database,
    r2: R2Bucket | undefined,
    envelopeId: string,
    tenantId: string,
): Promise<Response> {
    if (!r2) return new Response('Storage bucket not configured', { status: 500 });
    const db = drizzle(d1, { schema });
    const row = await db.select().from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.id, envelopeId)).get();
    if (!row || row.tenantId !== tenantId || row.status !== 'signed') {
        return new Response('Not Found', { status: 404 });
    }
    const key = r2Keys.agreementFile(tenantId, row.inspectionId, envelopeId, 'signed.pdf');
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: await deliverableHeaders(
            d1, tenantId, row.inspectionId, row.signedAt ?? row.createdAt,
            'application/pdf',
            `inline; filename="signed-agreement-${envelopeId.slice(0, 8)}.pdf"`,
        ),
    });
}

export async function downloadCertPdf(
    d1: D1Database,
    r2: R2Bucket | undefined,
    envelopeId: string,
    tenantId: string,
): Promise<Response> {
    if (!r2) return new Response('Storage bucket not configured', { status: 500 });
    const db = drizzle(d1, { schema });
    const row = await db.select().from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.id, envelopeId)).get();
    if (!row || row.tenantId !== tenantId) {
        return new Response('Not Found', { status: 404 });
    }
    const key = r2Keys.agreementFile(tenantId, row.inspectionId, envelopeId, 'certificate.pdf');
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: await deliverableHeaders(
            d1, tenantId, row.inspectionId, row.signedAt ?? row.createdAt,
            'application/pdf',
            `inline; filename="certificate-${envelopeId.slice(0, 8)}.pdf"`,
        ),
    });
}

export async function downloadEvidenceZip(
    d1: D1Database,
    r2: R2Bucket | undefined,
    envelopeId: string,
    tenantId: string,
): Promise<Response> {
    if (!r2) return new Response('Storage bucket not configured', { status: 500 });
    const db = drizzle(d1, { schema });
    const row = await db.select().from(schema.agreementRequests)
        .where(eq(schema.agreementRequests.id, envelopeId)).get();
    if (!row || row.tenantId !== tenantId) {
        return new Response('Not Found', { status: 404 });
    }
    const key = r2Keys.agreementFile(tenantId, row.inspectionId, envelopeId, 'evidence.zip');
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: await deliverableHeaders(
            d1, tenantId, row.inspectionId, row.signedAt ?? row.createdAt,
            'application/zip',
            `attachment; filename="evidence-${envelopeId.slice(0, 8)}.zip"`,
        ),
    });
}

const downloadAgreementRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/pdf',
    tags: ['admin'],
    summary: 'Download signed agreement PDF (Worker-proxied from R2)',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any() } }, description: 'PDF bytes, with x-artifact-status' },
        404: { description: 'Not signed or missing object' },
    },
    operationId: 'downloadSignedAgreement',
    description: 'Streams the workflow-rendered signed.pdf for an agreement request from R2 storage to the caller. Every 200 carries `x-artifact-status: current | superseded`: a correction published against the inspection supersedes this file, which stays retrievable as historical evidence but stops being the current answer. Cache directives match the claim, so no response can outlive it.',
}, { scopes: ['read'], tier: 'extended' }));

const downloadCertRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/certificate.pdf',
    tags: ['admin'],
    summary: 'Download Certificate of Completion PDF',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any() } }, description: 'PDF bytes, with x-artifact-status' },
        404: { description: 'Cert not yet rendered or missing' },
    },
    operationId: 'downloadCertificatePdf',
    description: 'Streams the workflow-rendered certificate.pdf from R2. Every 200 carries `x-artifact-status: current | superseded`: a correction published against the inspection supersedes this file, which stays retrievable as historical evidence but stops being the current answer. Cache directives match the claim, so no response can outlive it.',
}, { scopes: ['read'], tier: 'extended' }));

const downloadEvidenceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/evidence.zip',
    tags: ['admin'],
    summary: 'Download evidence pack zip',
    middleware: [requireRole('owner', 'manager', 'inspector')],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/zip': { schema: z.any() } }, description: 'evidence zip, with x-artifact-status' },
        404: { description: 'Missing' },
    },
    operationId: 'downloadEvidencePack',
    description: 'Returns evidence.zip from R2 (signed.pdf + certificate.pdf + audit-trail.json + public-key.pem). Every 200 carries `x-artifact-status: current | superseded`: a correction published against the inspection supersedes this file, which stays retrievable as historical evidence but stops being the current answer. Cache directives match the claim, so no response can outlive it.',
}, { scopes: ['read'], tier: 'extended' }));

const evidenceRoutes = createApiRouter()
    .openapi(downloadAgreementRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        return downloadAgreementPdf(c.env.DB, c.env.PHOTOS, id, tenantId);
    })
    .openapi(downloadCertRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        return downloadCertPdf(c.env.DB, c.env.PHOTOS, id, tenantId);
    })
    .openapi(downloadEvidenceRoute, async (c) => {
        const { id } = c.req.valid('param');
        const tenantId = c.get('tenantId') as string;
        return downloadEvidenceZip(c.env.DB, c.env.PHOTOS, id, tenantId);
    });

export type EvidenceApi = typeof evidenceRoutes;

export default evidenceRoutes;
