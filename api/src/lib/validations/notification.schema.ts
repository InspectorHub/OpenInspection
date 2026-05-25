import { z } from '@hono/zod-openapi';

export const NotificationTypeSchema = z.enum([
    'inspection.created',
    'inspection.confirmed',
    'booking.received',
    'report.published',
    'agreement.signed',
    'payment.received',
    'message.received',
]);

export const ListNotificationsQuerySchema = z.object({
    unread:           z.enum(['0', '1']).optional().describe('TODO describe unread field for the OpenInspection MCP integration'),
    includeArchived:  z.enum(['0', '1']).optional().describe('TODO describe includeArchived field for the OpenInspection MCP integration'),
    limit:            z.coerce.number().int().min(1).max(100).optional().describe('TODO describe limit field for the OpenInspection MCP integration'),
    cursor:           z.string().datetime().optional().describe('TODO describe cursor field for the OpenInspection MCP integration'),
});

export const MarkReadSchema = z.object({
    ids: z.array(z.string().min(1)).min(1).max(100).describe('TODO describe ids field for the OpenInspection MCP integration'),
});

export const NotificationDtoSchema = z.object({
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
    data: z.object({
        items:      z.array(NotificationDtoSchema).describe('TODO describe items field for the OpenInspection MCP integration'),
        nextCursor: z.string().nullable().describe('TODO describe nextCursor field for the OpenInspection MCP integration'),
    }).describe('TODO describe data field for the OpenInspection MCP integration'),
});

export const UnreadCountResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({ count: z.number().int().min(0).describe('TODO describe count field for the OpenInspection MCP integration') }).describe('TODO describe data field for the OpenInspection MCP integration'),
});
