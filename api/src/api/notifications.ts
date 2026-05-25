import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
import {
    ListNotificationsQuerySchema,
    ListNotificationsResponseSchema,
    UnreadCountResponseSchema,
    MarkReadSchema,
} from '../lib/validations/notification.schema';
import { Errors } from '../lib/errors';
import type { ListOptions } from '../services/notification.service';
import { withMcpMetadata } from "../lib/route-metadata-standards";

const notificationsRoutes = new OpenAPIHono<HonoConfig>();

/**
 * Convert a service-layer notification row to the API DTO.
 * Date fields → ISO strings; metadata is preserved as-is (object or null).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dto(row: any) {
    return {
        id:         row.id as string,
        type:       row.type as string,
        title:      row.title as string,
        body:       (row.body ?? null) as string | null,
        entityType: (row.entityType ?? null) as string | null,
        entityId:   (row.entityId ?? null) as string | null,
        metadata:   (row.metadata ?? null) as Record<string, unknown> | null,
        readAt:     row.readAt ? (row.readAt as Date).toISOString() : null,
        archivedAt: row.archivedAt ? (row.archivedAt as Date).toISOString() : null,
        createdAt:  (row.createdAt as Date).toISOString(),
    };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function requireUserId(c: any): string {
    const user = c.get('user');
    const sub = user?.sub as string | undefined;
    if (!sub) throw Errors.Unauthorized();
    return sub;
}

const OkResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ ok: z.literal(true).describe('TODO describe ok field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
});

// GET / — list notifications for current user
const listRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    tags: ["notifications"],
    summary: 'List notifications for current user',
    request: { query: ListNotificationsQuerySchema.describe('TODO describe query field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: ListNotificationsResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listNotifications",
    description: "Auto-generated placeholder for listNotifications (GET /, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'primary' }));
notificationsRoutes.openapi(listRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const userId   = requireUserId(c);
    const q = c.req.valid('query');
    const opts: ListOptions = {
        ...(q.unread === '1' ? { unread: true } : {}),
        ...(q.includeArchived === '1' ? { includeArchived: true } : {}),
        ...(q.limit ? { limit: q.limit } : {}),
        ...(q.cursor ? { cursor: q.cursor } : {}),
    };
    const result = await c.var.services.notification.list(tenantId, userId, opts);
    return c.json({
        success: true as const,
        data: { items: result.items.map(dto), nextCursor: result.nextCursor },
    }, 200);
});

// GET /unread-count
const unreadCountRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/unread-count',
    tags: ["notifications"],
    summary: 'Count unread notifications for current user',
    responses: {
        200: {
            content: { 'application/json': { schema: UnreadCountResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "unreadCountNotification",
    description: "Auto-generated placeholder for unreadCountNotification (GET /unread-count, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));
notificationsRoutes.openapi(unreadCountRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const userId   = requireUserId(c);
    const count = await c.var.services.notification.unreadCount(tenantId, userId);
    return c.json({ success: true as const, data: { count } }, 200);
});

// POST /mark-read
const markReadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/mark-read',
    tags: ["notifications"],
    summary: 'Mark a list of notifications as read',
    request: { body: { content: { 'application/json': { schema: MarkReadSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markReadNotification",
    description: "Auto-generated placeholder for markReadNotification (POST /mark-read, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));
notificationsRoutes.openapi(markReadRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const userId   = requireUserId(c);
    const { ids } = c.req.valid('json');
    await c.var.services.notification.markRead(tenantId, userId, ids);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
});

// POST /mark-all-read
const markAllRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/mark-all-read',
    tags: ["notifications"],
    summary: 'Mark every unread notification as read',
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markAllReadNotification",
    description: "Auto-generated placeholder for markAllReadNotification (POST /mark-all-read, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));
notificationsRoutes.openapi(markAllRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const userId   = requireUserId(c);
    await c.var.services.notification.markAllRead(tenantId, userId);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
});

// DELETE /{id} — archive (soft-delete)
const archiveRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}',
    tags: ["notifications"],
    summary: 'Archive a notification (soft-delete from inbox)',
    request: { params: z.object({ id: z.string().min(1).describe('TODO describe id field for the OpenInspection MCP integration') }).describe('TODO describe params field for the OpenInspection MCP integration') },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteNotification",
    description: "Auto-generated placeholder for deleteNotification (DELETE /{id}, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'primary' }));
notificationsRoutes.openapi(archiveRoute, async (c) => {
    const tenantId = c.get('tenantId');
    const userId   = requireUserId(c);
    const { id } = c.req.valid('param');
    await c.var.services.notification.archive(tenantId, userId, id);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
});

export default notificationsRoutes;
