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

/** The body every signed-in calendar read answers with when the request carries no session. */
export const CalendarNotAuthenticatedSchema = z.object({
    success: z.literal(false).describe('Always false on an error.'),
    error: z.object({ message: z.string().describe('Human-readable description of the error.') }).describe('Error detail.'),
}).openapi('CalendarNotAuthenticated');

/** GET /api/calendar/status: whether the signed-in user has a calendar connected and how it is doing. */
export const CalendarStatusResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        connected: z.boolean().describe('Whether the signed-in user has a calendar connection.'),
        capability: z.enum(['availability_read', 'events_read_write']).nullable().describe('What the connection may do: read availability only, or read and write events; null when not connected.'),
        provider: z.enum(['google', 'microsoft', 'apple']).nullable().describe('Which calendar system holds the connection; null when not connected.'),
        oauthConfigured: z.boolean().describe('Whether Google OAuth is configured on this deployment; it gates the Google connect button only.'),
        lastSyncAt: z.number().nullable().describe('Epoch milliseconds of the last successful sync; null when none has run.'),
        lastSyncError: z.string().nullable().describe('Why the last sync failed; null once a sync succeeds.'),
    }).describe('Connection status for the signed-in user.'),
}).openapi('CalendarStatusResponse');

const CalendarListEntrySchema = z.object({
    id: z.string().describe('Provider calendar id.'),
    summary: z.string().describe('Calendar display name.'),
    accessRole: z.string().describe('The user access role on the calendar: owner, writer, reader or freeBusyReader.'),
    primary: z.boolean().describe('Whether this is the account primary calendar.'),
});

/** GET /api/calendar/read-set: everything the My Schedule picker needs; `{ connected: false }` when nothing is connected. */
export const CalendarReadSetResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.union([
        z.object({ connected: z.literal(false).describe('No calendar is connected.') }),
        z.object({
            connected: z.literal(true).describe('A calendar is connected.'),
            connectionId: z.string().describe('Id of the signed-in user calendar connection.'),
            writeCalendarId: z.string().describe('The calendar new events are written to.'),
            readCalendarIds: z.array(z.string()).describe('The calendars whose busy time is read.'),
            calendars: z.array(CalendarListEntrySchema).describe('Every calendar the provider lists; empty when the provider could not be reached.'),
        }),
    ]).describe('The read set, or a not-connected marker.'),
}).openapi('CalendarReadSetResponse');

/** GET /api/calendar/ics-links: the three subscribe feeds, as paths. */
export const CalendarIcsLinksResponseSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        busyPath: z.string().nullable().describe('Path of the public busy-time feed; null until the inspector has a slug.'),
        schedulePath: z.string().nullable().describe('Path of the sealed-token schedule feed; null when the deployment has no signing secret.'),
        companyPath: z.string().nullable().describe('Path of the company-wide feed; null unless the caller is an owner or manager and the feed exists.'),
    }).describe('Subscribe feed paths.'),
}).openapi('CalendarIcsLinksResponse');

/** PUT /api/calendar/connections/{id}/calendars: the read set and write target as saved. */
export const CalendarReadSetSavedSchema = z.object({
    success: z.literal(true).describe('Always true on success.'),
    data: z.object({
        readCalendarIds: z.array(z.string()).describe('The calendars whose busy time is now read, Primary always included.'),
        writeCalendarId: z.string().describe('The calendar new events are now written to.'),
    }).describe('The read set and write target as saved.'),
}).openapi('CalendarReadSetSaved');

/** The error body of the save-set PUT: a message, plus a code or validation details on some answers. */
export const CalendarReadSetErrorSchema = z.object({
    success: z.literal(false).describe('Always false on an error.'),
    error: z.object({
        message: z.string().describe('Human-readable description of the error.'),
        code: z.string().optional().describe('Stable error code, present when the read-set rules refuse the choice.'),
        details: z.unknown().optional().describe('Field-level validation details, present when the body is not a valid read set.'),
    }).describe('Error detail.'),
}).openapi('CalendarReadSetError');
