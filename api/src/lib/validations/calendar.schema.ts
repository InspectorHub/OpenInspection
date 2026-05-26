import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Schema for the calendar sync operation response.
 */
export const CalendarSyncResponseSchema = createApiResponseSchema(
    z.object({
        blockedDatesCreated: z.number().openapi({ example: 5 }).describe('TODO describe blockedDatesCreated field for the OpenInspection MCP integration'),
        totalEvents: z.number().openapi({ example: 12 }).describe('TODO describe totalEvents field for the OpenInspection MCP integration'),
    })
).openapi('CalendarSyncResponse');

/**
 * Query schema for the Google OAuth callback.
 */
export const CalendarCallbackQuerySchema = z.object({
    code: z.string().optional().describe('TODO describe code field for the OpenInspection MCP integration'),
    state: z.string().optional().describe('TODO describe state field for the OpenInspection MCP integration'),
    error: z.string().optional().describe('TODO describe error field for the OpenInspection MCP integration'),
});
