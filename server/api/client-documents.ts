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
import { MAX_BYTES } from '../services/client-document.service';
import { DOCUMENT_CATEGORIES } from '../lib/db/schema';

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
    } catch {
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
            uploadedByRef: u.uploadedByRef,
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
