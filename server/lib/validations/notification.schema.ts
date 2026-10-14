import { z } from '@hono/zod-openapi';

export const ListNotificationsQuerySchema = z.object({
    unread:           z.enum(['0', '1']).optional().describe('Pass 1 to return only unread notifications; 0 or omitted returns both read and unread.'),
    includeArchived:  z.enum(['0', '1']).optional().describe('Pass 1 to include archived notifications; by default they are left out.'),
    limit:            z.coerce.number().int().min(1).max(100).optional().describe('Maximum notifications per page, 1-100. Defaults to 50.'),
    cursor:           z.string().datetime().optional().describe('ISO 8601 timestamp taken from meta.nextCursor of the previous page; returns notifications created before it.'),
});

export const MarkReadSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100).describe('Ids of the notifications to mark as read.'),
});

const NotificationDtoSchema = z.object({
    id:         z.string(),
    type:       z.string(),
    title:      z.string(),
    body:       z.string().nullable(),
    entityType: z.string().nullable(),
    entityId:   z.string().nullable(),
    metadata:   z.record(z.string(), z.unknown()).nullable(),
    readAt:     z.string().nullable(),
    archivedAt: z.string().nullable(),
    createdAt:  z.string(),
});

export const ListNotificationsResponseSchema = z.object({
    success: z.literal(true),
    data: z.array(NotificationDtoSchema),
    meta: z.object({
        nextCursor: z.string().nullable(),
    }),
});

export const UnreadCountResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({ count: z.number().int().min(0) }),
});
