import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import * as schema from '../lib/db/schema';
import { requireRole } from '../lib/middleware/rbac';
import { withMcpMetadata } from '../lib/route-metadata-standards';

/**
 * Pure download helpers exported for unit testing. The OpenAPIHono route
 * handlers below are thin wrappers that pull tenantId from the JWT context
 * and forward to these.
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
    const key = `tenants/${tenantId}/agreements/${envelopeId}/signed.pdf`;
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="signed-agreement-${envelopeId.slice(0, 8)}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
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
    const key = `tenants/${tenantId}/agreements/${envelopeId}/certificate.pdf`;
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `inline; filename="certificate-${envelopeId.slice(0, 8)}.pdf"`,
            'Cache-Control': 'private, max-age=300',
        },
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
    const key = `tenants/${tenantId}/agreements/${envelopeId}/evidence.zip`;
    const obj = await r2.get(key);
    if (!obj) return new Response('Not Found', { status: 404 });
    return new Response(obj.body, {
        status: 200,
        headers: {
            'Content-Type': 'application/zip',
            'Content-Disposition': `attachment; filename="evidence-${envelopeId.slice(0, 8)}.zip"`,
            'Cache-Control': 'private, max-age=300',
        },
    });
}

const downloadAgreementRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/pdf',
    tags: ['admin'],
    summary: 'Download signed agreement PDF (Worker-proxied from R2)',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any() } }, description: 'PDF bytes' },
        404: { description: 'Not signed or missing object' },
    },
    operationId: 'downloadSignedAgreement',
    description: 'Streams the workflow-rendered signed.pdf for an agreement request from R2 storage to the caller.',
}, { scopes: ['read'], tier: 'extended' }));

const downloadCertRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/certificate.pdf',
    tags: ['admin'],
    summary: 'Download Certificate of Completion PDF',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/pdf': { schema: z.any() } }, description: 'PDF bytes' },
        404: { description: 'Cert not yet rendered or missing' },
    },
    operationId: 'downloadCertificatePdf',
    description: 'Streams the workflow-rendered certificate.pdf from R2.',
}, { scopes: ['read'], tier: 'extended' }));

const downloadEvidenceRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/agreement-requests/{id}/evidence.zip',
    tags: ['admin'],
    summary: 'Download evidence pack zip',
    middleware: [requireRole(['owner', 'admin', 'inspector'])],
    request: { params: z.object({ id: z.string().describe('Agreement request (envelope) identifier') }) },
    responses: {
        200: { content: { 'application/zip': { schema: z.any() } }, description: 'evidence zip' },
        404: { description: 'Missing' },
    },
    operationId: 'downloadEvidencePack',
    description: 'Returns evidence.zip from R2 (signed.pdf + certificate.pdf + audit-trail.json + public-key.pem).',
}, { scopes: ['read'], tier: 'extended' }));

export const evidenceRoutes = createApiRouter()
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
