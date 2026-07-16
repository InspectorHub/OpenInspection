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
    code: z.string().optional().describe('Authorization code from the OAuth provider'),
    state: z.string().optional().describe('Opaque OAuth state token'),
    error: z.string().optional().describe('OAuth error code when consent is denied'),
});

/**
 * Query schema for initiating calendar OAuth connect.
 */
export const CalendarConnectQuerySchema = z.object({
    capability: z.enum(['availability_read', 'events_read_write']).default('events_read_write'),
    provider: z.enum(['google']).default('google'),
});
