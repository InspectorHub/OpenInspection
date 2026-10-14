import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import {
    ListNotificationsQuerySchema,
    ListNotificationsResponseSchema,
    UnreadCountResponseSchema,
    MarkReadSchema,
} from '../lib/validations/notification.schema';
import { Errors } from '../lib/errors';
import type { ListOptions } from '../services/notification.service';
import { withMcpMetadata } from "../lib/route-metadata-standards";

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
    request: { query: ListNotificationsQuerySchema },
    responses: {
        200: {
            content: { 'application/json': { schema: ListNotificationsResponseSchema } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "listNotifications",
    description: "Lists the calling user's own in-app notifications, newest first, within the current company. Archived ones are excluded unless includeArchived=1. Paged with a cursor: when meta.nextCursor is non-null, pass it as cursor to fetch the next page. Requires a signed-in user."
}, { scopes: ['read'], tier: 'primary' }));

// GET /unread-count
const unreadCountRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/unread-count',
    tags: ["notifications"],
    summary: 'Count unread notifications for current user',
    responses: {
        200: {
            content: { 'application/json': { schema: UnreadCountResponseSchema } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "unreadCountNotification",
    description: "Auto-generated placeholder for unreadCountNotification (GET /unread-count, notifications domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['read'], tier: 'extended' }));

// POST /mark-read
const markReadRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/mark-read',
    tags: ["notifications"],
    summary: 'Mark a list of notifications as read',
    request: { body: { content: { 'application/json': { schema: MarkReadSchema.describe('The notifications to mark as read.') } } } },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markReadNotification",
    description: "Mark the listed notifications as read by stamping their read time. Only the calling user's own notifications are touched: ids that belong to someone else, do not exist or are already read are skipped silently, and the call still answers ok. Idempotent, a repeat changes nothing. Available to any signed-in user."
}, { scopes: ['write'], tier: 'extended' }));

// POST /mark-all-read
const markAllRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/mark-all-read',
    tags: ["notifications"],
    summary: 'Mark every unread notification as read',
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "markAllReadNotification",
    description: "Mark every unread notification of the calling user in the current company as read, archived ones included. Other users' notifications are not affected. Idempotent, a repeat changes nothing. Available to any signed-in user."
}, { scopes: ['write'], tier: 'extended' }));

// DELETE /{id} — archive (soft-delete)
const archiveRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/{id}',
    tags: ["notifications"],
    summary: 'Archive a notification (soft-delete from inbox)',
    request: { params: z.object({ id: z.string().min(1).describe('Id of the notification to archive; must belong to the calling user.') }) },
    responses: {
        200: {
            content: { 'application/json': { schema: OkResponseSchema } },
            description: 'OK',
        },
    },
    security: [{ bearerAuth: [] }],
    operationId: "deleteNotification",
    description: "Archives one of the calling user's notifications so it no longer appears in the default list; it is not erased and can still be listed with includeArchived=1. Only the caller's own notifications are affected, and an unknown id is silently ignored (still returns ok)."
}, { scopes: ['write'], tier: 'primary' }));

const notificationsRoutes = createApiRouter()
    .openapi(listRoute, async (c) => {
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
            data: result.items.map(dto),
            meta: { nextCursor: result.nextCursor },
        }, 200);
    })
    .openapi(unreadCountRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const userId   = requireUserId(c);
        const count = await c.var.services.notification.unreadCount(tenantId, userId);
        return c.json({ success: true as const, data: { count } }, 200);
    })
    .openapi(markReadRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const userId   = requireUserId(c);
        const { ids } = c.req.valid('json');
        await c.var.services.notification.markRead(tenantId, userId, ids);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(markAllRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const userId   = requireUserId(c);
        await c.var.services.notification.markAllRead(tenantId, userId);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    })
    .openapi(archiveRoute, async (c) => {
        const tenantId = c.get('tenantId');
        const userId   = requireUserId(c);
        const { id } = c.req.valid('param');
        await c.var.services.notification.archive(tenantId, userId, id);
        return c.json({ success: true as const, data: { ok: true as const } }, 200);
    });

export type NotificationsApi = typeof notificationsRoutes;

export default notificationsRoutes;
