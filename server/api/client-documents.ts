/**
 * Client-facing public document routes (unified client portal, section ⑦).
 *
 * Streaming upload / list / download / delete of inspection documents for the
 * CLIENT side. Gated by EITHER:
 *   - the unified-portal session cookie `__Host-portal_session` (verified here,
 *     because the portal session middleware only runs on `/api/portal/*` — NOT
 *     on `/api/public/*`), resolved to a live grant via
 *     PortalAccessService.resolveByEmailAndInspection, OR
 *   - a per-inspection `?token=` (the persistent per-recipient portal token),
 *     resolved via resolvePortalAccess.
 *
 * The PUT upload and the file download are RAW-STREAM routes (the PUT body is
 * `c.req.raw.body`, the download is a byte stream), so they stay plain `put/get` handlers with
 * `zod.safeParse` query validation per the CLAUDE.md workaround-route rule. The JSON list
 * and delete routes are OpenAPI routes.
 *
 * The global JWT middleware skips `/api/public/*` (server/index.ts isPublic
 * allowlist), so authentication is performed entirely inside `resolveClientActor`.
 */
import { createRoute, z } from '@hono/zod-openapi';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { createApiRouter } from '../lib/openapi-router';
import type { ApiOf } from '../lib/api-schema';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { resolveClientActor } from '../lib/portal-client-actor';
import { requireRole } from '../lib/middleware/rbac';
import { contentDisposition } from '../lib/content-disposition';
import { MAX_BYTES, PayloadTooLargeError } from '../services/client-document.service';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES, UPLOADER_KINDS } from '../lib/db/schema';

const uploadQuerySchema = z.object({
    filename: z.string().min(1),
    category: z.enum(DOCUMENT_CATEGORIES),
    label: z.string().optional(),
});

const idParam = z.object({ id: z.string().describe('Id of the inspection whose documents are addressed.') });
const docParams = idParam.extend({ docId: z.string().describe('Id of the document to act on.') });
const errorBody = (what: string) => ({ content: { 'application/json': { schema: z.object({ error: z.string().describe('Short message saying what went wrong.') }) } }, description: what });
const documentFields = {
    id: z.string().describe('Document id.'),
    filename: z.string().describe('Original uploaded filename.'),
    category: z.enum(DOCUMENT_CATEGORIES).describe('Filing category chosen at upload.'),
    sizeBytes: z.number().describe('File size in bytes.'),
    createdAt: z.string().describe('When the document was uploaded, as an ISO timestamp.'),
    uploadedByKind: z.enum(UPLOADER_KINDS).describe('Which seat uploaded the document.'),
    uploadedByName: z.string().nullable().describe('Display name of the uploader, when known.'),
    visibility: z.enum(DOCUMENT_VISIBILITIES).describe('Whether the client can see the document.'),
    label: z.string().nullable().describe('Optional free-text label.'),
};
const okAck = { content: { 'application/json': { schema: z.object({ data: z.object({ ok: z.literal(true).describe('Always true on success.') }).describe('Delete acknowledgement.') }) } }, description: 'Deleted' };

const clientListRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/inspections/{id}/documents', tags: ['inspections', 'public'],
    request: { params: idParam },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ data: z.array(z.object({ ...documentFields, isOwn: z.boolean().describe('True when the caller uploaded this document.') })).describe('Documents the client may see, in storage order.') }) } }, description: 'Client-visible documents' },
        401: errorBody('No valid client grant for the inspection'),
    },
    operationId: 'listClientDocuments', summary: 'List client-visible inspection documents',
    description: 'Client-portal read of the documents on one inspection that the client may see: everything clients uploaded plus inspector uploads marked client visible. The caller authenticates with a portal session or a per-inspection token inside the handler, not with a staff session.',
}, { scopes: [], tier: 'excluded' }));

const clientDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/inspections/{id}/documents/{docId}', tags: ['inspections', 'public'],
    request: { params: docParams },
    responses: {
        200: okAck,
        401: errorBody('No valid client grant for the inspection'),
        403: errorBody('The document was uploaded by someone else'),
        404: errorBody('No such document on this inspection'),
    },
    operationId: 'deleteClientDocument', summary: 'Delete a document the client uploaded',
    description: 'Client-portal delete of one document on an inspection. Only the seat that uploaded the document may remove it. The caller authenticates with a portal session or a per-inspection token inside the handler, not with a staff session.',
}, { scopes: [], tier: 'excluded' }));

const clientDocumentsRoutes = createApiRouter();

// GET /api/public/inspections/:id/documents — list (client-visible only).
clientDocumentsRoutes.openapi(clientListRoute, async (c) => {
    const { id: inspectionId } = c.req.valid('param');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const all = await c.var.services.clientDocument.list(actor.tenantId, inspectionId);
    const data = all
        .filter((u) => u.uploadedByKind !== 'inspector' || u.visibility === 'client_visible')
        .map((u) => ({
            id: u.id,
            filename: u.filename,
            category: u.category,
            sizeBytes: u.sizeBytes,
            createdAt: u.createdAt,
            uploadedByKind: u.uploadedByKind,
            uploadedByName: u.uploadedByName,
            isOwn: u.uploadedByRef === actor.ref,
            visibility: u.visibility,
            label: u.label,
        }));
    return c.json({ data }, 200);
});

// DELETE /api/public/inspections/:id/documents/:docId — delete own upload only.
clientDocumentsRoutes.openapi(clientDeleteRoute, async (c) => {
    const { id: inspectionId, docId } = c.req.valid('param');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId) return c.json({ error: 'Not found' }, 404);
    if (row.uploadedByRef !== actor.ref) return c.json({ error: 'Forbidden' }, 403);

    await c.var.services.clientDocument.remove(actor.tenantId, docId);
    return c.json({ data: { ok: true as const } }, 200);
});

// PUT /api/public/inspections/:id/documents — streaming upload.
clientDocumentsRoutes.put('/inspections/:id/documents', async (c) => {
    const inspectionId = c.req.param('id');
    const parsed = uploadQuerySchema.safeParse({
        filename: c.req.query('filename'),
        category: c.req.query('category'),
        label: c.req.query('label'),
    });
    if (!parsed.success) return c.json({ error: 'Invalid upload parameters.' }, 400);

    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const len = Number(c.req.header('content-length') ?? '0');
    if (len > MAX_BYTES) return c.json({ error: 'File exceeds 100 MB.' }, 413);

    const contentType = c.req.header('content-type') ?? 'application/octet-stream';
    const { filename, category, label } = parsed.data;

    try {
        const row = await c.var.services.clientDocument.create(
            actor.tenantId,
            inspectionId,
            { kind: actor.kind, ref: actor.ref, name: actor.name },
            { filename, contentType, category, visibility: 'client_visible', label: label ?? null, sizeBytes: len },
            c.req.raw.body!,
        );
        return c.json({ data: { id: row.id, filename: row.filename, sizeBytes: row.sizeBytes, category: row.category } });
    } catch (err) {
        if (err instanceof PayloadTooLargeError) return c.json({ error: 'File exceeds 100 MB.' }, 413);
        return c.json({ error: 'Upload rejected.' }, 400);
    }
});

// GET /api/public/inspections/:id/documents/:docId — download (attachment).
clientDocumentsRoutes.get('/inspections/:id/documents/:docId', async (c) => {
    const inspectionId = c.req.param('id');
    const docId = c.req.param('docId');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId
        || (row.uploadedByKind === 'inspector' && row.visibility === 'internal')) {
        return c.json({ error: 'Not found' }, 404);
    }
    const obj = await c.var.services.clientDocument.getObject(row.r2Key);
    if (!obj) return c.json({ error: 'Not found' }, 404);

    return new Response(obj.body, {
        headers: {
            'Content-Type': row.contentType || 'application/octet-stream',
            'Content-Disposition': contentDisposition(row.filename, true, 'document'),
            'X-Content-Type-Options': 'nosniff',
        },
    });
});

/** Registration order of the OpenAPI routes (the upload and the download are plain handlers). */
export const clientDocumentsRouteConfigs = [clientListRoute, clientDeleteRoute] as const;
export type ClientDocumentsApi = ApiOf<typeof clientDocumentsRouteConfigs>;

export default clientDocumentsRoutes;

// ---------------------------------------------------------------------------
// Authed INSPECTOR document routes (unified client portal, section ⑦ — staff
// side). Same streaming operations as the client routes, but the actor is the
// authenticated inspector (kind='inspector', ref=userId). Mounted under
// `/api/inspections` BEHIND the global jwtAuthMiddleware (everything under
// `/api/inspections/*` not in the isPublic allowlist is authed by default), so
// the JWT context (`tenantId` + `user.sub`) is already populated here.
//
// Differences vs the client routes:
//   - list returns ALL rows (no visibility filter) — inspector sees everything.
//   - upload accepts a `visibility` query param (default 'client_visible').
//   - download has no visibility gate.
//   - delete allows ANY row in the tenant + inspection (not just own uploads).
// ---------------------------------------------------------------------------

const inspectorUploadQuerySchema = z.object({
    filename: z.string().min(1),
    category: z.enum(DOCUMENT_CATEGORIES),
    label: z.string().optional(),
    visibility: z.enum(DOCUMENT_VISIBILITIES).optional().default('client_visible'),
});

/** Resolve the authed inspector identity from JWT context. null → 401. */
function resolveInspectorActor(c: Context<HonoConfig>): { tenantId: string; userId: string; name: string | null } | null {
    const tenantId = c.get('tenantId');
    const userId = (c.get('user') as { sub?: string } | undefined)?.sub;
    if (!tenantId || !userId) return null;
    // The JWT carries no display-name claim; routes that need it look it up.
    return { tenantId, userId, name: null };
}

const inspectorListRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/{id}/documents', tags: ['inspections'],
    request: { params: idParam },
    responses: {
        200: { content: { 'application/json': { schema: z.object({ data: z.array(z.object({ ...documentFields, uploadedByRef: z.string().describe('Uploader reference: the client email or the inspector user id.') })).describe('Every document on the inspection, internal ones included.') }) } }, description: 'All documents' },
        401: errorBody('No authenticated user'),
    },
    operationId: 'listInspectionDocuments', summary: 'List all documents on an inspection',
    description: 'Staff read of every document attached to one inspection, including internal ones the client cannot see. Open to any signed-in staff member of the company.',
}, { scopes: ['read'], tier: 'extended' }));

const inspectorDeleteRoute = createRoute(withMcpMetadata({
    method: 'delete', path: '/{id}/documents/{docId}', tags: ['inspections'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: docParams },
    responses: {
        200: okAck,
        401: errorBody('No authenticated user'),
        404: errorBody('No such document on this inspection'),
    },
    operationId: 'deleteInspectionDocument', summary: 'Delete any document on an inspection',
    description: 'Staff delete of one document on an inspection, whoever uploaded it. Owners, managers and inspectors only.',
}, { scopes: ['write'], tier: 'extended' }));

const inspectorDocumentsRoutes = createApiRouter();

// GET /api/inspections/:id/documents — list ALL docs (inspector, no filter).
inspectorDocumentsRoutes.openapi(inspectorListRoute, async (c) => {
    const { id: inspectionId } = c.req.valid('param');
    const actor = resolveInspectorActor(c);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const all = await c.var.services.clientDocument.list(actor.tenantId, inspectionId);
    const data = all.map((u) => ({
        id: u.id,
        filename: u.filename,
        category: u.category,
        sizeBytes: u.sizeBytes,
        createdAt: u.createdAt,
        uploadedByKind: u.uploadedByKind,
        uploadedByName: u.uploadedByName,
        uploadedByRef: u.uploadedByRef,
        visibility: u.visibility,
        label: u.label,
    }));
    return c.json({ data }, 200);
});

// DELETE /api/inspections/:id/documents/:docId — delete ANY row (inspector).
inspectorDocumentsRoutes.openapi(inspectorDeleteRoute, async (c) => {
    const { id: inspectionId, docId } = c.req.valid('param');
    const actor = resolveInspectorActor(c);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId) return c.json({ error: 'Not found' }, 404);

    await c.var.services.clientDocument.remove(actor.tenantId, docId);
    return c.json({ data: { ok: true as const } }, 200);
});

// PUT /api/inspections/:id/documents — streaming upload (inspector).
inspectorDocumentsRoutes.put('/:id/documents', requireRole('owner', 'manager', 'inspector'), async (c) => {
    const inspectionId = c.req.param('id') as string;
    const parsed = inspectorUploadQuerySchema.safeParse({
        filename: c.req.query('filename'),
        category: c.req.query('category'),
        label: c.req.query('label'),
        visibility: c.req.query('visibility'),
    });
    if (!parsed.success) return c.json({ error: 'Invalid upload parameters.' }, 400);

    const actor = resolveInspectorActor(c);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const len = Number(c.req.header('content-length') ?? '0');
    if (len > MAX_BYTES) return c.json({ error: 'File exceeds 100 MB.' }, 413);

    const contentType = c.req.header('content-type') ?? 'application/octet-stream';
    const { filename, category, label, visibility } = parsed.data;

    try {
        const row = await c.var.services.clientDocument.create(
            actor.tenantId,
            inspectionId,
            { kind: 'inspector', ref: actor.userId, name: actor.name },
            { filename, contentType, category, visibility, label: label ?? null, sizeBytes: len },
            c.req.raw.body!,
        );
        return c.json({ data: { id: row.id, filename: row.filename, sizeBytes: row.sizeBytes, category: row.category, visibility: row.visibility } });
    } catch (err) {
        if (err instanceof PayloadTooLargeError) return c.json({ error: 'File exceeds 100 MB.' }, 413);
        return c.json({ error: 'Upload rejected.' }, 400);
    }
});

// GET /api/inspections/:id/documents/:docId — download (inspector, no gate).
inspectorDocumentsRoutes.get('/:id/documents/:docId', async (c) => {
    const inspectionId = c.req.param('id');
    const docId = c.req.param('docId');
    const actor = resolveInspectorActor(c);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId) return c.json({ error: 'Not found' }, 404);
    const obj = await c.var.services.clientDocument.getObject(row.r2Key);
    if (!obj) return c.json({ error: 'Not found' }, 404);

    return new Response(obj.body, {
        headers: {
            'Content-Type': row.contentType || 'application/octet-stream',
            'Content-Disposition': contentDisposition(row.filename, true, 'document'),
            'X-Content-Type-Options': 'nosniff',
        },
    });
});

/** Registration order of the OpenAPI routes (the upload and the download are plain handlers). */
export const inspectorDocumentsRouteConfigs = [inspectorListRoute, inspectorDeleteRoute] as const;
export type InspectorDocumentsApi = ApiOf<typeof inspectorDocumentsRouteConfigs>;

export { inspectorDocumentsRoutes };
