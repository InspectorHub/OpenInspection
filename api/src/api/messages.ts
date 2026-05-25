import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import { Errors } from '../lib/errors';
import { detectMime } from '../lib/file-validation';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const messageRoutes = new OpenAPIHono<HonoConfig>();

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
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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

messageRoutes.openapi(listRoute, async (c) => {
    const { inspectionId } = c.req.valid('param');
    const tenantId = c.get('tenantId');
    const svc = c.var.services.message;
    const [messages, token] = await Promise.all([
        svc.listForInspection(inspectionId, tenantId),
        svc.getOrCreateToken(inspectionId, tenantId),
    ]);
    // Mark all client messages read on inspector view.
    await svc.markAllReadForRole(inspectionId, tenantId, 'client');
    return c.json({ success: true, data: { messages, token } }, 200);
});

// POST /api/messages/inspections/{inspectionId} — send message as inspector
const sendRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{inspectionId}',
    tags: ["messages"],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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

messageRoutes.openapi(sendRoute, async (c) => {
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
});

// GET /api/messages/unread-count — sidebar badge
const unreadRoute = createRoute(withMcpMetadata({
    method: 'get', path: '/unread-count',
    tags: ["messages"],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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

messageRoutes.openapi(unreadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const count = await c.var.services.message.unreadCountForTenant(tenantId);
    return c.json({ success: true, data: { count } }, 200);
});

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

messageRoutes.openapi(publicListRoute, async (c) => {
    const { token } = c.req.valid('param');
    const svc = c.var.services.message;
    const insp = await svc.resolveByToken(token);
    if (!insp) throw Errors.NotFound('Conversation not found');
    const messages = await svc.listForInspection(insp.id, insp.tenantId);
    // Mark all inspector messages read on client view.
    await svc.markAllReadForRole(insp.id, insp.tenantId, 'inspector');
    return c.json({ success: true, data: { messages, inspection: {
        id: insp.id, propertyAddress: insp.propertyAddress, clientName: insp.clientName, date: insp.date,
    } } }, 200);
});

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

messageRoutes.openapi(publicSendRoute, async (c) => {
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
});

// ── T21: attachment upload routes ───────────────────────────────────────────────

const uploadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/inspections/{inspectionId}/upload',
    tags: ["messages"],
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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

messageRoutes.openapi(uploadRoute, async (c) => {
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
});

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

messageRoutes.openapi(publicUploadRoute, async (c) => {
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
});

export default messageRoutes;
