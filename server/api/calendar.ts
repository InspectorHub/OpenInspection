import { createRoute, z } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { legacyMounted, mounted, type ApiOf } from '../lib/api-schema';
import { importBusyForConnection } from '../lib/calendar/sync-engine';
import { resolveReadSet, saveReadSet, resolveReadCalendarIds } from '../lib/calendar/read-set';
import { SaveReadSetSchema } from '../lib/validations/calendar-read-set.schema';
import { AppError } from '../lib/errors';
import {
    CalendarNotAuthenticatedSchema, CalendarReadSetErrorSchema, CalendarReadSetResponseSchema, CalendarReadSetSavedSchema,
    CalendarStatusResponseSchema, CalendarSyncResponseSchema,
} from '../lib/validations/calendar.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { logger } from '../lib/logger';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import { getCalendarProvider } from '../lib/calendar/registry';
import {
    loadOpenCalendarConnection,
    markCalendarSynced,
} from '../lib/calendar/connection';
import { getGoogleCalendarStatus } from '../lib/calendar/status';
import { disconnectAndAudit, DisconnectQuerySchema, DISCONNECT_DESCRIPTION } from '../lib/calendar/disconnect';
import calendarBlockRoutes, { calendarBlockRouteConfigs } from './calendar-blocks';
import calendarIcsLinkRoutes, { calendarIcsLinkRouteConfigs } from './calendar-ics-links';
import calendarItemsRoutes, { calendarItemsRouteConfigs } from './calendar-items';
import calendarOAuthRoutes from './calendar/oauth';
import { getDrizzle } from '../lib/route-helpers';

/** DELETE /api/calendar/disconnect: disconnects the user's calendar and what it synced. */
const disconnectRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/disconnect',
    operationId: 'disconnectGoogleCalendar',
    tags: ['calendar'],
    summary: 'Disconnect a calendar integration',
    description: DISCONNECT_DESCRIPTION,
    request: { query: DisconnectQuerySchema },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('Disconnect acknowledgement'),
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/calendar/sync
 * Pulls busy blocks from the connected calendar provider.
 */
const syncRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sync',
    operationId: 'syncGoogleCalendarBusyBlocks',
    tags: ['calendar'],
    summary: 'Sync busy blocks from Google Calendar',
    description: 'Pulls upcoming busy time blocks from the inspector\'s connected calendar and merges them into availability overrides.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CalendarSyncResponseSchema.describe('Busy sync summary'),
                },
            },
            description: 'Success',
        },
        400: { description: 'Calendar not connected' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

/** GET /api/calendar/status: the signed-in user calendar connection and how it is doing. */
const statusRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/status',
    operationId: 'getGoogleCalendarStatus',
    tags: ['calendar'],
    summary: 'Get the calendar connection status',
    description: 'Reports whether the signed-in user has a calendar connected, which provider and capability it uses, whether Google OAuth is configured on this deployment, and when the last sync ran or why it failed.',
    responses: {
        200: { content: { 'application/json': { schema: CalendarStatusResponseSchema } }, description: 'Connection status' },
        401: { content: { 'application/json': { schema: CalendarNotAuthenticatedSchema } }, description: 'Not signed in' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'extended' }));

/** GET /api/calendar/read-set: the calendars to read busy time from and the write target, in one call. */
const readSetRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/read-set',
    operationId: 'getCalendarReadSet',
    tags: ['calendar'],
    summary: 'Get the calendar read set',
    description: 'Returns everything the My Schedule calendar picker needs for the signed-in user connection: the calendars the provider lists, the current read set and the write target. Answers { connected: false } when no calendar is connected.',
    responses: {
        200: { content: { 'application/json': { schema: CalendarReadSetResponseSchema } }, description: 'Read set' },
        401: { content: { 'application/json': { schema: CalendarNotAuthenticatedSchema } }, description: 'Not signed in' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'extended' }));

/**
 * PUT /api/calendar/connections/{id}/calendars: save the multi-read set and the single write target under the
 * locked invariants (write editable, write in read, Primary always read). The handler reads and validates the body
 * itself, after it has found the caller's own connection, so no request body is declared: a validator in front of
 * it would answer a bad body before the 404 and in the validation envelope instead of `{ message, details }`.
 */
const saveReadSetRoute = createRoute(withMcpMetadata({
    method: 'put',
    path: '/connections/{id}/calendars',
    operationId: 'saveCalendarReadSet',
    tags: ['calendar'],
    summary: 'Save the calendar read set',
    description: 'Saves which of the signed-in user calendars are read for busy time and which one new events are written to. The JSON body is {readCalendarIds, writeCalendarId}: readCalendarIds lists at least one calendar id, writeCalendarId is one of them and must be a calendar the user can edit, and the Primary calendar is always kept in the read set. Only the caller own connection can be saved; any other id answers 404.',
    request: { params: z.object({ id: z.string().describe('Id of the signed-in user calendar connection whose read set is saved.') }) },
    responses: {
        200: { content: { 'application/json': { schema: CalendarReadSetSavedSchema } }, description: 'Read set saved' },
        400: { content: { 'application/json': { schema: CalendarReadSetErrorSchema } }, description: 'Invalid read set, or the calendar integration is not configured' },
        401: { content: { 'application/json': { schema: CalendarNotAuthenticatedSchema } }, description: 'Not signed in' },
        404: { content: { 'application/json': { schema: CalendarReadSetErrorSchema } }, description: 'No such calendar connection for the caller' },
        409: { content: { 'application/json': { schema: CalendarReadSetErrorSchema } }, description: 'The write calendar is not editable by the user or is not in the read set' },
        500: { content: { 'application/json': { schema: CalendarReadSetErrorSchema } }, description: 'The provider calendar list could not be fetched' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: [], tier: 'excluded' }));

const app = createApiRouter();
app.route('/', calendarBlockRoutes);
app.route('/', calendarIcsLinkRoutes);
app.route('/', calendarItemsRoutes);
app.openapi(disconnectRoute, async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

    const tenantId = c.get('tenantId') as string;
    await disconnectAndAudit(c, tenantId, user.sub, c.req.valid('query').provider);
    return c.json({ success: true }, 200);
});
app.openapi(syncRoute, async (c) => {
    const jwtUser = c.get('user');
    if (!jwtUser) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

    const tenantId = c.get('tenantId') as string;
    const open = await loadOpenCalendarConnection(
        c.env.DB,
        tenantId,
        jwtUser.sub,
        c.env.JWT_SECRET,
        c.env.JWT_SECRET_PREVIOUS,
    );
    if (!open) {
        return c.json({ success: false, error: { message: 'Google Calendar not connected' } }, 400);
    }

    const auth = await getCalendarProvider(open.connection.provider).resolveAuth({
        tenantId, credentials: open.credentials, env: c.env,
    });
    if (!auth) {
        return c.json({ success: false, error: { message: 'Google Calendar integration is not configured' } }, 400);
    }
    const db = getDrizzle(c);

    // One code path for the button and the cron sweep. It consumes RAW
    // listBusy output: mergeBusyIntervals unions overlapping ranges into
    // anonymous blocks and discards the per-event externalId, without which
    // OI cannot recognise the events it pushed itself, cannot see
    // recurrence, and cannot key the upsert on anything stable.
    let result;
    try {
        result = await importBusyForConnection(db, open.connection, auth);
    } catch (e) {
        logger.error('[calendar] sync listBusy failed', { tenantId }, e instanceof Error ? e : undefined);
        return c.json({ success: false, error: { message: 'Failed to fetch Google Calendar busy blocks' } }, 500);
    }

    const inspectorId = jwtUser.sub;
    await markCalendarSynced(c.env.DB, tenantId, inspectorId);

    return c.json({
        success: true,
        data: {
            blockedDatesCreated: result.upserted,
            totalEvents: result.totalEvents,
            skipped: result.skipped,
        },
    }, 200);
});
app.openapi(statusRoute, async (c) => {
    const user = c.get('user');
    if (!user) return c.json({ success: false as const, error: { message: 'Not authenticated' } }, 401);
    const tenantId = c.get('tenantId') as string;
    return c.json({ success: true as const, data: await getGoogleCalendarStatus(c.env, tenantId, user.sub) }, 200);
});
app.openapi(readSetRoute, async (c) => {
    const jwtUser = c.get('user');
    if (!jwtUser) return c.json({ success: false as const, error: { message: 'Not authenticated' } }, 401);
    const tenantId = c.get('tenantId') as string;
    const open = await loadOpenCalendarConnection(
        c.env.DB, tenantId, jwtUser.sub, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
    );
    if (!open) return c.json({ success: true as const, data: { connected: false as const } }, 200);

    const db = getDrizzle(c);
    const readCalendarIds = await resolveReadCalendarIds(db, {
        tenantId,
        connectionId: open.connection.id,
        fallbackCalendarId: open.connection.calendarId,
    });
    const provider = getCalendarProvider(open.connection.provider);
    const auth = await provider.resolveAuth({
        tenantId, credentials: open.credentials, env: c.env,
    });
    let calendars: Awaited<ReturnType<typeof provider.listCalendars>> = [];
    if (auth) {
        try {
            calendars = await provider.listCalendars({ auth });
        } catch (e) {
            logger.warn('[calendar] read-set listCalendars failed', {
                tenantId, error: e instanceof Error ? e.message : String(e),
            });
        }
    }
    return c.json({
        success: true as const,
        data: {
            connected: true as const,
            connectionId: open.connection.id,
            writeCalendarId: open.connection.calendarId,
            readCalendarIds,
            calendars,
        },
    }, 200);
});
app.openapi(saveReadSetRoute, async (c) => {
    const jwtUser = c.get('user');
    if (!jwtUser) return c.json({ success: false as const, error: { message: 'Not authenticated' } }, 401);
    const tenantId = c.get('tenantId') as string;
    const connId = c.req.valid('param').id;
    const open = await loadOpenCalendarConnection(
        c.env.DB, tenantId, jwtUser.sub, c.env.JWT_SECRET, c.env.JWT_SECRET_PREVIOUS,
    );
    if (!open || open.connection.id !== connId) {
        return c.json({ success: false as const, error: { message: 'Google Calendar not connected' } }, 404);
    }
    const parsed = SaveReadSetSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) {
        return c.json({ success: false as const, error: { message: 'Invalid read set', details: parsed.error.flatten() } }, 400);
    }
    const provider = getCalendarProvider(open.connection.provider);
    const auth = await provider.resolveAuth({
        tenantId, credentials: open.credentials, env: c.env,
    });
    if (!auth) {
        return c.json({ success: false as const, error: { message: 'Google Calendar integration is not configured' } }, 400);
    }
    let available;
    try {
        available = await provider.listCalendars({ auth });
    } catch (e) {
        logger.error('[calendar] listCalendars (save) failed', { tenantId }, e instanceof Error ? e : undefined);
        return c.json({ success: false as const, error: { message: 'Failed to fetch Google calendars' } }, 500);
    }
    let resolved;
    try {
        resolved = resolveReadSet(available, parsed.data);
    } catch (e) {
        if (e instanceof AppError) {
            return c.json({ success: false as const, error: { code: e.code, message: e.message } }, e.status as 400);
        }
        throw e;
    }
    await saveReadSet(getDrizzle(c), { tenantId, connectionId: connId, resolved });
    return c.json({
        success: true as const,
        data: { readCalendarIds: resolved.readCalendarIds, writeCalendarId: resolved.writeCalendarId },
    }, 200);
});
app.route('/', calendarOAuthRoutes);

/** Registration order, mounts included. Drives `CalendarApi`; a test pins it to what `app` really registered. */
export const calendarRouteParts = [
    mounted('/', calendarBlockRoutes, calendarBlockRouteConfigs),
    mounted('/', calendarIcsLinkRoutes, calendarIcsLinkRouteConfigs),
    mounted('/', calendarItemsRoutes, calendarItemsRouteConfigs),
    disconnectRoute,
    syncRoute,
    statusRoute,
    readSetRoute,
    saveReadSetRoute,
    legacyMounted('/', calendarOAuthRoutes),
] as const;

export type CalendarApi = ApiOf<typeof calendarRouteParts>;

export default app;
