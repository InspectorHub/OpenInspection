/**
 * Customer messaging — converged onto the unified resource URL shape (the same
 * pattern client-documents.ts established):
 *
 *   Inspector (JWT, mounted at /api/inspections):
 *     GET    /api/inspections/:id/messages                       — list + mark client msgs read
 *     POST   /api/inspections/:id/messages                       — send as inspector
 *     POST   /api/inspections/:id/messages/upload                — attach a file (multipart)
 *     GET    /api/inspections/:id/messages/attachments/:attId    — download an attachment
 *
 *   Client (portal session OR per-inspection token, mounted at /api/public):
 *     GET    /api/public/inspections/:id/messages                — list + mark inspector msgs read
 *     POST   /api/public/inspections/:id/messages                — send as client
 *     POST   /api/public/inspections/:id/messages/upload         — attach a file (multipart)
 *     GET    /api/public/inspections/:id/messages/attachments/:attId — download an attachment
 *
 *   Cross-cutting summary (JWT, mounted at /api/messages):
 *     GET    /api/messages/unread-count                          — sidebar badge (per tenant)
 *
 * A URL names the RESOURCE (an inspection's messages); auth is a credential
 * (JWT cookie for inspector; portal session cookie / ?token for client), NOT
 * part of the path. The client side authenticates via resolveClientActor
 * (shared with client-documents) — the messageToken keying is retired.
 */
import { Hono } from 'hono';
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { detectMime } from '../lib/file-validation';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { resolveClientActor } from '../lib/portal-client-actor';
import { buildPortalUrl } from '../lib/portal-urls';
import { getBaseUrl, resolveTenantSlug } from '../lib/url';
import type { HonoConfig } from '../types/hono';

const AttachmentSchema = z.object({
    id: z.string().describe('Stable attachment identifier within the message.'),
    key: z.string().describe('R2 object key the attachment bytes are stored under.'),
    name: z.string().describe('Original uploaded filename.'),
    size: z.number().describe('Attachment size in bytes.'),
    type: z.string().describe('Detected MIME type of the attachment.'),
    uploadedAt: z.number().describe('Epoch-ms timestamp the attachment was uploaded.'),
});

// ── Inspector routes (authed by global JWT; mounted at /api/inspections) ──────

// GET /api/inspections/{inspectionId}/messages — list inspector view
const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{inspectionId}/messages',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('Inspection whose conversation to list.') }).describe('Path parameters.') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: z.array(z.any()).describe('Messages for the inspection, oldest first.'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'getMessageInspection',
    summary: 'List messages for an inspection (inspector view)',
    description: 'Returns the message thread for an inspection (oldest first) and marks all client messages read. Inspector-authenticated.',
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/inspections/{inspectionId}/messages — send message as inspector
const sendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{inspectionId}/messages',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ inspectionId: z.string().describe('Inspection to post the message to.') }).describe('Path parameters.'),
        body: { content: { 'application/json': { schema: z.object({
            body: z.string().min(1).max(5000).describe('Message body text.'),
            attachments: z.array(AttachmentSchema).max(5).optional().describe('Up to 5 previously-uploaded attachments.'),
        }).describe('Message payload.') } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('Whether the request succeeded.'), data: z.any().describe('The created message row.') }).describe('Created message.') } }, description: 'Created' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'createMessageInspection',
    summary: 'Send a message to a client (inspector)',
    description: 'Creates an inspector-authored message on an inspection and notifies the client by email. Inspector-authenticated.',
}, { scopes: ['write'], tier: 'extended' }));

// POST /api/inspections/{inspectionId}/messages/upload — attach a file (inspector)
const uploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/{inspectionId}/messages/upload',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('Inspection the attachment belongs to.') }).describe('Path parameters.') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: AttachmentSchema.describe('The stored attachment descriptor.'),
        }) } }, description: 'OK' },
    },
    operationId: 'uploadMessageInspection',
    summary: 'Upload a message attachment (inspector)',
    description: 'Streams a multipart file into R2 and returns the attachment descriptor to attach to a subsequent message. Inspector-authenticated.',
}, { scopes: ['write'], tier: 'extended' }));

// GET /api/inspections/{inspectionId}/messages/attachments/{attachmentId}
const attachmentRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/{inspectionId}/messages/attachments/{attachmentId}',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({
        inspectionId: z.string().describe('Inspection the attachment belongs to.'),
        attachmentId: z.string().describe('Attachment id within the conversation.'),
    }) },
    responses: {
        200: { content: { 'application/octet-stream': { schema: z.any() } }, description: 'Attachment bytes' },
        404: { description: 'Not found' },
    },
    operationId: 'downloadMessageAttachmentInspection',
    summary: 'Download a message attachment (inspector)',
    description: 'Streams a message attachment from R2, scoped by inspection id + attachment id. Inspector-authenticated.',
}, { scopes: ['read'], tier: 'extended' }));

// GET /api/messages/unread-count — sidebar badge (cross-inspection summary)
const unreadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/unread-count',
    tags: ['messages'],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('Whether the request succeeded.'),
            data: z.object({ count: z.number().describe('Number of unread client messages across the tenant.') }).describe('Unread summary.'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: 'unreadCountMessage',
    summary: 'Unread client-message count for the tenant',
    description: 'Returns the count of unread client messages across all inspections in the tenant (sidebar badge). The lone cross-cutting messages summary — every other messages route is per-inspection.',
}, { scopes: ['read'], tier: 'extended' }));

// ── helpers (shared upload logic) ────────────────────────────────────────────

/** Validate + persist a multipart attachment to R2; returns the descriptor. */
async function storeAttachment(
    photos: R2Bucket | undefined,
    file: File | undefined,
    keyPrefix: string,
): Promise<{ id: string; key: string; name: string; size: number; type: string; uploadedAt: number }> {
    if (!file) throw Errors.BadRequest('file required');
    if (file.size > 10 * 1024 * 1024) throw Errors.BadRequest('file too large (max 10MB)');
    const buf = new Uint8Array(await file.arrayBuffer());
    const detected = detectMime(buf);
    if (!detected && !file.name.toLowerCase().endsWith('.heic')) throw Errors.BadRequest('unsupported file type');
    const id = crypto.randomUUID();
    const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
    const key = `${keyPrefix}/${id}/${id}.${ext}`;
    if (!photos) throw Errors.BadRequest('Storage not available');
    await photos.put(key, buf, { httpMetadata: { contentType: detected ?? file.type } });
    return { id, key, name: file.name, size: file.size, type: detected ?? file.type, uploadedAt: Date.now() };
}

/** Stream a resolved attachment descriptor from R2 with a safe filename. */
function streamAttachment(
    obj: R2ObjectBody,
    att: { name: string; type: string },
): Response {
    // Sanitize the filename for the Content-Disposition header (strip quotes and
    // control/path characters) so a crafted attachment name can't inject header
    // tokens.
    const safeName = (att.name || 'attachment').replace(/["\\\r\n]/g, '').replace(/[/\\]/g, '_').slice(0, 200);
    const headers = new Headers();
    headers.set('Content-Type', att.type || obj.httpMetadata?.contentType || 'application/octet-stream');
    headers.set('Content-Disposition', `attachment; filename="${safeName}"`);
    headers.set('Cache-Control', 'private, max-age=300');
    if (obj.httpEtag) headers.set('etag', obj.httpEtag);
    return new Response(obj.body, { status: 200, headers });
}

// ── Inspector router (typed client + MCP) ────────────────────────────────────

export const inspectorMessageRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const svc = c.var.services.message;
        const messages = await svc.listForInspection(inspectionId, tenantId);
        // Mark all client messages read on inspector view.
        await svc.markAllReadForRole(inspectionId, tenantId, 'client');
        return c.json({ success: true, data: messages }, 200);
    })
    .openapi(sendRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const { body, attachments } = c.req.valid('json');
        const jwtUser = c.get('user');
        const svc = c.var.services.message;
        const row = await svc.createMessage({
            tenantId,
            inspectionId,
            fromRole: 'inspector',
            fromName: (jwtUser as { name?: string } | undefined)?.name ?? null,
            body,
            attachments: attachments ?? [],
        });
        // T22: notify client. Build a unified-portal Messages deep-link the same
        // way the report-ready email does (per-recipient portal token + slug), so
        // the no-login client lands in the Hub messages tab already authorized.
        try {
            let clientViewUrl: string | undefined;
            try {
                const clientEmail = await svc.clientEmailForInspection(inspectionId, tenantId);
                if (clientEmail) {
                    const slug = await resolveTenantSlug(c, tenantId);
                    const portalToken = await c.var.services.portalAccess.issueToken({
                        tenantId, inspectionId, recipientEmail: clientEmail, role: 'client',
                    });
                    clientViewUrl = buildPortalUrl(getBaseUrl(c), slug, inspectionId, portalToken, 'messages');
                }
            } catch { /* fall back to the Hub overview inside the email service */ }
            await c.var.services.email.sendMessageNotification('client', inspectionId, row, {
                db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
                clientViewUrl,
            });
        } catch { /* silent */ }
        return c.json({ success: true, data: row }, 201);
    })
    .openapi(uploadRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const fd = await c.req.parseBody();
        const data = await storeAttachment(c.env.PHOTOS, fd['file'] as File | undefined, `${tenantId}/${inspectionId}/messages`);
        return c.json({ success: true, data }, 200);
    })
    .openapi(attachmentRoute, async (c) => {
        const { inspectionId, attachmentId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const att = await c.var.services.message.resolveAttachmentForInspection(inspectionId, tenantId, attachmentId);
        if (!att) throw Errors.NotFound('Attachment not found');
        if (!c.env.PHOTOS) throw Errors.NotFound('Storage not available');
        const obj = await c.env.PHOTOS.get(att.key);
        if (!obj) throw Errors.NotFound('Attachment not found');
        return streamAttachment(obj, att);
    });

export type InspectorMessagesApi = typeof inspectorMessageRoutes;

// ── Cross-cutting summary router (mounted at /api/messages) ───────────────────

export const messageRoutes = createApiRouter()
    .openapi(unreadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const count = await c.var.services.message.unreadCountForTenant(tenantId);
        return c.json({ success: true, data: { count } }, 200);
    });

export type MessagesApi = typeof messageRoutes;

// ── Client router (resolveClientActor-gated; mounted at /api/public) ──────────

const sendBodySchema = z.object({
    body: z.string().min(1).max(5000),
    attachments: z.array(z.object({
        id: z.string(), key: z.string(), name: z.string(), size: z.number(), type: z.string(), uploadedAt: z.number(),
    })).max(5).optional(),
});

export const clientMessageRoutes = new Hono<HonoConfig>();

// GET /api/public/inspections/:id/messages — list + mark inspector msgs read.
clientMessageRoutes.get('/inspections/:id/messages', async (c) => {
    const inspectionId = c.req.param('id');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const svc = c.var.services.message;
    const messages = await svc.listForInspection(inspectionId, actor.tenantId);
    // Mark all inspector messages read on client view.
    await svc.markAllReadForRole(inspectionId, actor.tenantId, 'inspector');
    return c.json({ success: true, data: messages }, 200);
});

// POST /api/public/inspections/:id/messages — send as client.
clientMessageRoutes.post('/inspections/:id/messages', async (c) => {
    const inspectionId = c.req.param('id');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const parsed = sendBodySchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Invalid message payload.' }, 400);
    const svc = c.var.services.message;
    const row = await svc.createMessage({
        tenantId: actor.tenantId,
        inspectionId,
        fromRole: 'client',
        // Attribution: prefer the inspection's stored client name; fall back to
        // the actor's verified email so the inspector sees who replied.
        fromName: (await svc.clientNameForInspection(inspectionId, actor.tenantId)) ?? actor.ref,
        body: parsed.data.body,
        attachments: parsed.data.attachments ?? [],
    });
    // T22: notify inspector
    try {
        await c.var.services.email.sendMessageNotification('inspector', inspectionId, row, {
            db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
        });
    } catch { /* silent */ }
    return c.json({ success: true, data: row }, 201);
});

// POST /api/public/inspections/:id/messages/upload — attach a file (client).
clientMessageRoutes.post('/inspections/:id/messages/upload', async (c) => {
    const inspectionId = c.req.param('id');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const fd = await c.req.parseBody();
    try {
        const data = await storeAttachment(c.env.PHOTOS, fd['file'] as File | undefined, `${actor.tenantId}/${inspectionId}/messages`);
        return c.json({ success: true, data }, 200);
    } catch (err) {
        const status = (err as { status?: number })?.status;
        return c.json({ error: 'Upload rejected.' }, status === 400 ? 400 : 400);
    }
});

// GET /api/public/inspections/:id/messages/attachments/:attId — download.
clientMessageRoutes.get('/inspections/:id/messages/attachments/:attachmentId', async (c) => {
    const inspectionId = c.req.param('id');
    const attachmentId = c.req.param('attachmentId');
    const actor = await resolveClientActor(c, inspectionId);
    if (!actor) return c.json({ error: 'Unauthorized' }, 401);
    const att = await c.var.services.message.resolveAttachmentForInspection(inspectionId, actor.tenantId, attachmentId);
    if (!att) return c.json({ error: 'Not found' }, 404);
    if (!c.env.PHOTOS) return c.json({ error: 'Not found' }, 404);
    const obj = await c.env.PHOTOS.get(att.key);
    if (!obj) return c.json({ error: 'Not found' }, 404);
    return streamAttachment(obj, att);
});

export type ClientMessagesApi = typeof clientMessageRoutes;

export default messageRoutes;
