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
 * These are RAW-STREAM routes (the PUT body is `c.req.raw.body`), so they use a
 * plain Hono router with `app.put/get/delete` rather than OpenAPIHono
 * `createRoute()` — query validation is `zod.safeParse` per the CLAUDE.md
 * workaround-route rule.
 *
 * The global JWT middleware skips `/api/public/*` (server/index.ts isPublic
 * allowlist), so authentication is performed entirely inside `resolveClientActor`.
 */
import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import { z } from 'zod';
import type { Context } from 'hono';
import type { HonoConfig } from '../types/hono';
import { resolvePortalAccess } from '../lib/public-access';
import { verifyPortalSession } from '../lib/portal-session';
import { contentDisposition } from '../lib/content-disposition';
import { MAX_BYTES, PayloadTooLargeError } from '../services/client-document.service';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES } from '../lib/db/schema';

interface ClientActor {
    tenantId: string;
    kind: 'client' | 'co_client';
    ref: string;          // recipient email (uploader identity)
    name: string | null;
}

/**
 * Resolve the acting CLIENT for this request. Token path first (URL ?token),
 * then session-cookie path. Only `client` / `co_client` roles are accepted
 * (agents are NOT document uploaders here). Returns null → caller 401.
 */
async function resolveClientActor(
    c: Context<HonoConfig>,
    inspectionId: string,
): Promise<ClientActor | null> {
    const token = c.req.query('token');
    const grant = await resolvePortalAccess(c.var.services.portalAccess, token, inspectionId);
    if (grant && (grant.role === 'client' || grant.role === 'co_client')) {
        return { tenantId: grant.tenantId, kind: grant.role, ref: grant.recipientEmail, name: null };
    }
    const cookie = getCookie(c, '__Host-portal_session');
    const sess = cookie ? await verifyPortalSession(c.env.JWT_SECRET, cookie) : null;
    if (sess) {
        const row = await c.var.services.portalAccess.resolveByEmailAndInspection(sess.email, inspectionId);
        if (row && (row.role === 'client' || row.role === 'co_client')) {
            return { tenantId: row.tenantId, kind: row.role, ref: sess.email, name: null };
        }
    }
    return null;
}

const uploadQuerySchema = z.object({
    filename: z.string().min(1),
    category: z.enum(DOCUMENT_CATEGORIES),
    label: z.string().optional(),
});

const clientDocumentsRoutes = new Hono<HonoConfig>();

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

// GET /api/public/inspections/:id/documents — list (client-visible only).
clientDocumentsRoutes.get('/inspections/:id/documents', async (c) => {
    const inspectionId = c.req.param('id');
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
    return c.json({ data });
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

// DELETE /api/public/inspections/:id/documents/:docId — delete own upload only.
clientDocumentsRoutes.delete('/inspections/:id/documents/:docId', async (c) => {
    const inspectionId = c.req.param('id');
    const docId = c.req.param('docId');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId) return c.json({ error: 'Not found' }, 404);
    if (row.uploadedByRef !== actor.ref) return c.json({ error: 'Forbidden' }, 403);

    await c.var.services.clientDocument.remove(actor.tenantId, docId);
    return c.json({ data: { ok: true } });
});

export type ClientDocumentsApi = typeof clientDocumentsRoutes;
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

const inspectorDocumentsRoutes = new Hono<HonoConfig>();

// PUT /api/inspections/:id/documents — streaming upload (inspector).
inspectorDocumentsRoutes.put('/:id/documents', async (c) => {
    const inspectionId = c.req.param('id');
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

// GET /api/inspections/:id/documents — list ALL docs (inspector, no filter).
inspectorDocumentsRoutes.get('/:id/documents', async (c) => {
    const inspectionId = c.req.param('id');
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
    return c.json({ data });
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

// DELETE /api/inspections/:id/documents/:docId — delete ANY row (inspector).
inspectorDocumentsRoutes.delete('/:id/documents/:docId', async (c) => {
    const inspectionId = c.req.param('id');
    const docId = c.req.param('docId');
    const actor = resolveInspectorActor(c);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);

    const row = await c.var.services.clientDocument.get(actor.tenantId, docId);
    if (!row || row.inspectionId !== inspectionId) return c.json({ error: 'Not found' }, 404);

    await c.var.services.clientDocument.remove(actor.tenantId, docId);
    return c.json({ data: { ok: true } });
});

export type InspectorDocumentsApi = typeof inspectorDocumentsRoutes;
export { inspectorDocumentsRoutes };
