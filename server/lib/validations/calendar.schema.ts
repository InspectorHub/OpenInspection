import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Schema for the calendar sync operation response.
 */
export const CalendarSyncResponseSchema = createApiResponseSchema(
    z.object({
        blockedDatesCreated: z.number().openapi({ example: 5 }).describe('Busy override rows written for this inspector in the sync window.'),
        totalEvents: z.number().openapi({ example: 12 }).describe('Provider events returned in the sync window, before the import rules ran.'),
        skipped: z.object({
            oi_originated: z.number().openapi({ example: 2 }).describe('Events OI itself pushed, skipped so a booking cannot block its own inspector.'),
            recurring_instance: z.number().openapi({ example: 4 }).describe('Instances of a recurring series; v1 imports one-off events only.'),
            before_connect: z.number().openapi({ example: 0 }).describe('Events last touched before the calendar was connected; no historical backfill.'),
        }).describe('Counts of provider events the import rules excluded.'),
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
