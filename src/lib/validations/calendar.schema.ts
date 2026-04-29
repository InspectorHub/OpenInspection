import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Schema for the calendar sync operation response.
 */
export const CalendarSyncResponseSchema = createApiResponseSchema(
    z.object({
        blockedDatesCreated: z.number().openapi({ example: 5 }),
        totalEvents: z.number().openapi({ example: 12 }),
    })
).openapi('CalendarSyncResponse');

/**
 * Query schema for the Google OAuth callback.
 */
export const CalendarCallbackQuerySchema = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
});
