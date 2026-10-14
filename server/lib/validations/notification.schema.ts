import { z } from '@hono/zod-openapi';

export const ListNotificationsQuerySchema = z.object({
    unread:           z.enum(['0', '1']).optional().describe('Pass 1 to return only unread notifications; 0 or omitted returns both read and unread.'),
    includeArchived:  z.enum(['0', '1']).optional().describe('Pass 1 to include archived notifications; by default they are left out.'),
    limit:            z.coerce.number().int().min(1).max(100).optional().describe('Maximum notifications per page, 1-100. Defaults to 50.'),
    cursor:           z.string().datetime().optional().describe('ISO 8601 timestamp taken from meta.nextCursor of the previous page; returns notifications created before it.'),
});

export const MarkReadSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100).describe('TODO describe ids field for the OpenInspection MCP integration'),
});

const NotificationDtoSchema = z.object({
    id:         z.string().describe('TODO describe id field for the OpenInspection MCP integration'),
    type:       z.string().describe('TODO describe type field for the OpenInspection MCP integration'),
    title:      z.string().describe('TODO describe title field for the OpenInspection MCP integration'),
    body:       z.string().nullable().describe('TODO describe body field for the OpenInspection MCP integration'),
    entityType: z.string().nullable().describe('TODO describe entityType field for the OpenInspection MCP integration'),
    entityId:   z.string().nullable().describe('TODO describe entityId field for the OpenInspection MCP integration'),
    metadata:   z.record(z.string(), z.unknown()).nullable().describe('TODO describe metadata field for the OpenInspection MCP integration'),
    readAt:     z.string().nullable().describe('TODO describe readAt field for the OpenInspection MCP integration'),
    archivedAt: z.string().nullable().describe('TODO describe archivedAt field for the OpenInspection MCP integration'),
    createdAt:  z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
});

export const ListNotificationsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.array(NotificationDtoSchema).describe('TODO describe data field for the OpenInspection MCP integration'),
    meta: z.object({
        nextCursor: z.string().nullable().describe('TODO describe nextCursor field for the OpenInspection MCP integration'),
    }).describe('TODO describe meta field for the OpenInspection MCP integration'),
});

export const UnreadCountResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ count: z.number().int().min(0).describe('TODO describe count field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
});
