import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { detectMime } from '../lib/file-validation';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const AttachmentSchema = z.object({
    id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
    name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    size: z.number().describe('TODO describe size field for the OpenInspection MCP integration'),
    type: z.string().describe('TODO describe type field for the OpenInspection MCP integration'),
    uploadedAt: z.number().describe('TODO describe uploadedAt field for the OpenInspection MCP integration'),
});

// GET /api/messages/inspections/{inspectionId} — list inspector view
const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/inspections/{inspectionId}',
    tags: ["messages"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ messages: z.array(z.any()).describe('TODO describe messages field for the OpenInspection MCP integration'), token: z.string().nullable().describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: "getMessageInspection",
    summary: "Get message inspection for current tenant",
    description: "Auto-generated placeholder for getMessageInspection (GET /inspections/{inspectionId}, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// POST /api/messages/inspections/{inspectionId} — send message as inspector
const sendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{inspectionId}',
    tags: ["messages"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        params: z.object({ inspectionId: z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: z.object({
            body: z.string().min(1).max(5000).describe('TODO describe body field for the OpenInspection MCP integration'),
            attachments: z.array(AttachmentSchema).max(5).optional().describe('TODO describe attachments field for the OpenInspection MCP integration'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.any().describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
        401: { description: 'Unauthorized' },
    },
    operationId: "createMessageInspection",
    summary: "Create message inspection for current tenant",
    description: "Auto-generated placeholder for createMessageInspection (POST /inspections/{inspectionId}, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// GET /api/messages/unread-count — sidebar badge
const unreadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/unread-count',
    tags: ["messages"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ count: z.number().describe('TODO describe count field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'OK' },
        401: { description: 'Unauthorized' },
    },
    operationId: "unreadCountMessage",
    summary: "Unread count message for current tenant",
    description: "Auto-generated placeholder for unreadCountMessage (GET /unread-count, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// ── T20: public client routes (no JWT, token-based) ─────────────────────────────

const publicListRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/public/{token}',
    tags: ["messages"],
    request: { params: z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ messages: z.array(z.any()).describe('TODO describe messages field for the OpenInspection MCP integration'), inspection: z.any().describe('TODO describe inspection field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'OK' },
        404: { description: 'Not found' },
    },
    operationId: "getMessagePublic",
    summary: "Get message public for current tenant",
    description: "Auto-generated placeholder for getMessagePublic (GET /public/{token}, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

const publicSendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/public/{token}',
    tags: ["messages"],
    request: {
        params: z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration'),
        body: { content: { 'application/json': { schema: z.object({
            body: z.string().min(1).max(5000).describe('TODO describe body field for the OpenInspection MCP integration'),
            attachments: z.array(AttachmentSchema).max(5).optional().describe('TODO describe attachments field for the OpenInspection MCP integration'),
        }).describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        201: { content: { 'application/json': { schema: z.object({ success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'), data: z.any().describe('TODO describe data field for the OpenInspection MCP integration') }).describe('TODO describe schema field for the OpenInspection MCP integration') } }, description: 'Created' },
        404: { description: 'Not found' },
    },
    operationId: "createMessagePublic",
    summary: "Create message public for current tenant",
    description: "Auto-generated placeholder for createMessagePublic (POST /public/{token}, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ── T21: attachment upload routes ───────────────────────────────────────────────

const uploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{inspectionId}/upload',
    tags: ["messages"],
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: { params: z.object({ inspectionId: z.string().describe('TODO describe inspectionId field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'), key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'), size: z.number().describe('TODO describe size field for the OpenInspection MCP integration'), type: z.string().describe('TODO describe type field for the OpenInspection MCP integration'), uploadedAt: z.number().describe('TODO describe uploadedAt field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'OK' },
    },
    operationId: "uploadMessage",
    summary: "Upload message for current tenant",
    description: "Auto-generated placeholder for uploadMessage (POST /inspections/{inspectionId}/upload, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const publicUploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/public/{token}/upload',
    tags: ["messages"],
    request: { params: z.object({ token: z.string().describe('TODO describe token field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: { content: { 'application/json': { schema: z.object({
            success: z.boolean().describe('TODO describe success field for the OpenInspection MCP integration'),
            data: z.object({ id: z.string().describe('TODO describe id field for the OpenInspection MCP integration'), key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'), name: z.string().describe('TODO describe name field for the OpenInspection MCP integration'), size: z.number().describe('TODO describe size field for the OpenInspection MCP integration'), type: z.string().describe('TODO describe type field for the OpenInspection MCP integration'), uploadedAt: z.number().describe('TODO describe uploadedAt field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
        }) } }, description: 'OK' },
        404: { description: 'Not found' },
    },
    operationId: "uploadMessage",
    summary: "Upload message for current tenant",
    description: "Auto-generated placeholder for uploadMessage (POST /public/{token}/upload, messages domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// ── B-5: public attachment download (token-scoped, no JWT) ──────────────────────
// The public messages page links each attachment here. The route is scoped by
// the conversation `token` (already in the /api/messages/public/ public
// allowlist) + the attachment `id`, so it can only serve files attached to that
// conversation — never an arbitrary R2 key. The original filename + MIME type
// come from the stored attachment metadata.
const publicAttachmentRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/public/{token}/attachments/{attachmentId}',
    tags: ["messages"],
    request: { params: z.object({
        token: z.string().describe('Conversation token from the public messages link.'),
        attachmentId: z.string().describe('Attachment id within the conversation.'),
    }) },
    responses: {
        200: { content: { 'application/octet-stream': { schema: z.any() } }, description: 'Attachment bytes' },
        404: { description: 'Not found' },
    },
    operationId: "downloadMessageAttachmentPublic",
    summary: "Download a message attachment for public view",
    description: "Streams a message attachment from R2 for the public (token-gated) conversation view. Scoped by conversation token + attachment id; sets Content-Disposition with the original filename.",
}, { scopes: ['read'], tier: 'extended' }));

export const messageRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const svc = c.var.services.message;
        const [messages, token] = await Promise.all([
            svc.listForInspection(inspectionId, tenantId),
            svc.getOrCreateToken(inspectionId, tenantId),
        ]);
        // Mark all client messages read on inspector view.
        await svc.markAllReadForRole(inspectionId, tenantId, 'client');
        return c.json({ success: true, data: messages, meta: { token } }, 200);
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
        // T22: notify client
        try {
            await c.var.services.email.sendMessageNotification('client', inspectionId, row, {
                db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
            });
        } catch { /* silent */ }
        return c.json({ success: true, data: row }, 201);
    })
    .openapi(unreadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const count = await c.var.services.message.unreadCountForTenant(tenantId);
        return c.json({ success: true, data: { count } }, 200);
    })
    .openapi(publicListRoute, async (c) => {
        const { token } = c.req.valid('param');
        const svc = c.var.services.message;
        const insp = await svc.resolveByToken(token);
        if (!insp) throw Errors.NotFound('Conversation not found');
        const messages = await svc.listForInspection(insp.id, insp.tenantId);
        // Mark all inspector messages read on client view.
        await svc.markAllReadForRole(insp.id, insp.tenantId, 'inspector');
        return c.json({ success: true, data: messages, meta: { inspection: {
            id: insp.id, propertyAddress: insp.propertyAddress, clientName: insp.clientName, date: insp.date,
        } } }, 200);
    })
    .openapi(publicSendRoute, async (c) => {
        const { token } = c.req.valid('param');
        const { body, attachments } = c.req.valid('json');
        const svc = c.var.services.message;
        const insp = await svc.resolveByToken(token);
        if (!insp) throw Errors.NotFound('Conversation not found');
        const row = await svc.createMessage({
            tenantId: insp.tenantId,
            inspectionId: insp.id,
            fromRole: 'client',
            fromName: insp.clientName ?? null,
            body,
            attachments: attachments ?? [],
        });
        // T22: notify inspector
        try {
            await c.var.services.email.sendMessageNotification('inspector', insp.id, row, {
                db: c.env.DB, kv: c.env.TENANT_CACHE, baseUrl: c.env.APP_BASE_URL || `https://${c.req.header('host') ?? ''}`,
            });
        } catch { /* silent */ }
        return c.json({ success: true, data: row }, 201);
    })
    .openapi(uploadRoute, async (c) => {
        const { inspectionId } = c.req.valid('param');
        const tenantId = c.get('tenantId');
        const fd = await c.req.parseBody();
        const file = fd['file'] as File | undefined;
        if (!file) throw Errors.BadRequest('file required');
        if (file.size > 10 * 1024 * 1024) throw Errors.BadRequest('file too large (max 10MB)');
        const buf = new Uint8Array(await file.arrayBuffer());
        const detected = detectMime(buf);
        if (!detected && !file.name.toLowerCase().endsWith('.heic')) throw Errors.BadRequest('unsupported file type');
        const id = crypto.randomUUID();
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
        const key = `${tenantId}/${inspectionId}/messages/${id}/${id}.${ext}`;
        if (!c.env.PHOTOS) throw Errors.BadRequest('Storage not available');
        await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: detected ?? file.type } });
        return c.json({ success: true, data: { id, key, name: file.name, size: file.size, type: detected ?? file.type, uploadedAt: Date.now() } }, 200);
    })
    .openapi(publicUploadRoute, async (c) => {
        const { token } = c.req.valid('param');
        const svc = c.var.services.message;
        const insp = await svc.resolveByToken(token);
        if (!insp) throw Errors.NotFound('Conversation not found');
        const fd = await c.req.parseBody();
        const file = fd['file'] as File | undefined;
        if (!file) throw Errors.BadRequest('file required');
        if (file.size > 10 * 1024 * 1024) throw Errors.BadRequest('file too large (max 10MB)');
        const buf = new Uint8Array(await file.arrayBuffer());
        const detected = detectMime(buf);
        if (!detected && !file.name.toLowerCase().endsWith('.heic')) throw Errors.BadRequest('unsupported file type');
        const id = crypto.randomUUID();
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase().slice(0, 8);
        const key = `${insp.tenantId}/${insp.id}/messages/_pending/${token}/${id}.${ext}`;
        if (!c.env.PHOTOS) throw Errors.BadRequest('Storage not available');
        await c.env.PHOTOS.put(key, buf, { httpMetadata: { contentType: detected ?? file.type } });
        return c.json({ success: true, data: { id, key, name: file.name, size: file.size, type: detected ?? file.type, uploadedAt: Date.now() } }, 200);
    })
    .openapi(publicAttachmentRoute, async (c) => {
        const { token, attachmentId } = c.req.valid('param');
        const svc = c.var.services.message;
        const att = await svc.resolveAttachmentByToken(token, attachmentId);
        if (!att) throw Errors.NotFound('Attachment not found');
        if (!c.env.PHOTOS) throw Errors.NotFound('Storage not available');
        const obj = await c.env.PHOTOS.get(att.key);
        if (!obj) throw Errors.NotFound('Attachment not found');
        // Sanitize the filename for the Content-Disposition header (strip quotes
        // and control/path characters) so a crafted attachment name can't inject
        // header tokens.
        const safeName = (att.name || 'attachment').replace(/["\\\r\n]/g, '').replace(/[/\\]/g, '_').slice(0, 200);
        const headers = new Headers();
        headers.set('Content-Type', att.type || obj.httpMetadata?.contentType || 'application/octet-stream');
        headers.set('Content-Disposition', `attachment; filename="${safeName}"`);
        headers.set('Cache-Control', 'private, max-age=300');
        if (obj.httpEtag) headers.set('etag', obj.httpEtag);
        return new Response(obj.body, { status: 200, headers });
    });

export type MessagesApi = typeof messageRoutes;

export default messageRoutes;
