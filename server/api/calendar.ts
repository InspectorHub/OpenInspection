import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { users } from '../lib/db/schema/tenant';
import { availabilityOverrides } from '../lib/db/schema/inspection';
import { CalendarSyncResponseSchema, CalendarCallbackQuerySchema } from '../lib/validations/calendar.schema';
import { SuccessResponseSchema } from '../lib/validations/shared.schema';
import { logger } from '../lib/logger';
import { getBaseUrl } from '../lib/url';
import { withMcpMetadata } from '../lib/route-metadata-standards';
import {
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_CALENDAR_API,
    getRedirectUri,
    refreshAccessToken,
    createCalendarEvent,
    syncEventsToGcal,
    type GoogleTokenResponse,
    type GoogleCalendarResponse,
    type GoogleEvent,
} from '../lib/google-calendar';

/**
 * DELETE /api/calendar/disconnect
 * Removes stored Google tokens.
 */
const disconnectRoute = createRoute(withMcpMetadata({
    method: 'delete',
    path: '/disconnect',
    operationId: 'disconnectGoogleCalendar',
    tags: ['calendar'],
    summary: 'Disconnect Google Calendar integration',
    description: 'Removes the stored Google Calendar OAuth refresh token and calendar ID for the current inspector. Future syncs will fail until they reconnect.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: SuccessResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' }
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/calendar/sync
 * Pulls busy blocks from Google Calendar.
 */
const syncRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/sync',
    operationId: 'syncGoogleCalendarBusyBlocks',
    tags: ['calendar'],
    summary: 'Sync busy blocks from Google Calendar',
    description: 'Pulls the upcoming busy time blocks from the inspector\'s connected Google Calendar and merges them into availability overrides so booking pages skip those slots.',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CalendarSyncResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
        400: { description: 'Calendar not connected' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' }
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['write'], tier: 'extended' }));

export const calendarRoutes = createApiRouter()
    .openapi(disconnectRoute, async (c) => {
        const user = c.get('user');
        if (!user) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const db = drizzle(c.env.DB);
        const tenantId = c.get('tenantId') as string;
        await db.update(users)
            .set({ googleRefreshToken: null, googleCalendarId: null })
            .where(and(eq(users.id, user.sub), eq(users.tenantId, tenantId)));

        return c.json({ success: true }, 200);
    })
    .openapi(syncRoute, async (c) => {
        const jwtUser = c.get('user');
        if (!jwtUser) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const db = drizzle(c.env.DB);
        const userResult = await db.select().from(users).where(eq(users.id, jwtUser.sub)).limit(1);
        const dbUser = userResult[0];
        if (!dbUser?.googleRefreshToken) {
            return c.json({ success: false, error: { message: 'Google Calendar not connected' } }, 400);
        }

        const accessToken = await refreshAccessToken(
            c.env.GOOGLE_CLIENT_ID,
            c.env.GOOGLE_CLIENT_SECRET,
            dbUser.googleRefreshToken,
        );

        const timeMin = new Date().toISOString();
        const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        const eventsRes = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(dbUser.googleCalendarId ?? 'primary')}/events?` +
            new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' }),
            { headers: { 'Authorization': `Bearer ${accessToken}` } },
        );

        if (!eventsRes.ok) {
            return c.json({ success: false, error: { message: 'Failed to fetch Google Calendar events' } }, 500);
        }

        const eventsData = await eventsRes.json() as { items?: GoogleEvent[] };
        const events = eventsData.items ?? [];
        const tenantId = c.get('tenantId') as string;
        const inspectorId = jwtUser.sub;
        let created = 0;

        for (const event of events) {
            if (!event.start?.date && !event.start?.dateTime) continue;
            const date = (event.start.date ?? event.start.dateTime?.slice(0, 10)) as string;

            const existing = await db.select({ id: availabilityOverrides.id })
                .from(availabilityOverrides)
                .where(and(
                    eq(availabilityOverrides.tenantId, tenantId),
                    eq(availabilityOverrides.inspectorId, inspectorId),
                    eq(availabilityOverrides.date, date)
                ))
                .limit(1);
            if (existing.length) continue;

            await db.insert(availabilityOverrides).values({
                id: crypto.randomUUID(),
                tenantId,
                inspectorId,
                date,
                isAvailable: false,
                startTime: null,
                endTime: null,
                createdAt: new Date(),
            });
            created++;
        }

        return c.json({
            success: true,
            data: { blockedDatesCreated: created, totalEvents: events.length }
        }, 200);
    })
    /**
     * POST /api/calendar/sync-events — Spec 4D polish.
     * Pushes all upcoming inspection_events to the user's connected Google Calendar.
     */
    .post('/sync-events', async (c) => {
        const jwtUser = c.get('user');
        if (!jwtUser) return c.json({ success: false, error: { message: 'Not authenticated' } }, 401);

        const db = drizzle(c.env.DB);
        const userResult = await db.select().from(users).where(eq(users.id, jwtUser.sub)).limit(1);
        const dbUser = userResult[0];
        if (!dbUser?.googleRefreshToken) {
            return c.json({ success: false, error: { message: 'Google Calendar not connected' } }, 400);
        }

        const result = await syncEventsToGcal(
            c.env.DB,
            dbUser.tenantId as string,
            c.env.GOOGLE_CLIENT_ID,
            c.env.GOOGLE_CLIENT_SECRET,
            dbUser.googleRefreshToken,
            dbUser.googleCalendarId ?? 'primary',
        );
        return c.json({ success: true, data: result });
    })
    /**
     * GET /api/calendar/connect
     * Redirects inspector to Google OAuth consent.
     */
    .get('/connect', async (c) => {
        if (!c.env.GOOGLE_CLIENT_ID) {
            return c.json({ success: false, error: { message: 'Google Calendar integration is not configured' } }, 501);
        }

        const user = c.get('user');
        if (!user) return c.redirect('/login');

        const baseUrl = getBaseUrl(c);
        const state = user.sub;

        const params = new URLSearchParams({
            client_id: c.env.GOOGLE_CLIENT_ID,
            redirect_uri: getRedirectUri(baseUrl),
            response_type: 'code',
            scope: 'https://www.googleapis.com/auth/calendar.events',
            access_type: 'offline',
            prompt: 'consent',
            state,
        });

        return c.redirect(`${GOOGLE_AUTH_URL}?${params}`);
    })
    /**
     * GET /api/calendar/callback
     * Exchanges OAuth code and stores refresh token.
     */
    .get('/callback', async (c) => {
        const parsed = CalendarCallbackQuerySchema.safeParse(c.req.query());
        if (!parsed.success) {
            return c.json({ success: false, error: { message: 'Invalid query parameters' } }, 400);
        }
        const { code, state, error } = parsed.data;

        if (error) {
            return c.redirect(`/settings/integrations?calendar_error=${encodeURIComponent(error)}`, 302);
        }
        if (!code || !state) return c.json({ success: false, error: { message: 'Missing code or state' } }, 400);

        const baseUrl = getBaseUrl(c);

        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: c.env.GOOGLE_CLIENT_ID,
                client_secret: c.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: getRedirectUri(baseUrl),
                grant_type: 'authorization_code',
            }),
        });

        const tokenData = await tokenRes.json() as GoogleTokenResponse;
        if (!tokenRes.ok) {
            logger.error('[calendar] Token exchange failed', { tokenData: String(tokenData) });
            return c.json({ success: false, error: { message: 'Failed to exchange authorization code' } }, 500);
        }

        const { refresh_token, access_token } = tokenData;

        const calRes = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
            headers: { 'Authorization': `Bearer ${access_token}` },
        });
        const calData = await calRes.json() as GoogleCalendarResponse;
        const calendarId = calData.id ?? 'primary';

        // Verify the logged-in user matches the OAuth state to prevent CSRF token injection.
        // The global JWT middleware (index.ts) already verified the cookie and set c.get('user').
        const user = c.get('user');
        if (!user) return c.redirect('/login');
        if (user.sub !== state) {
            return c.json({ success: false, error: { message: 'OAuth state mismatch' } }, 403);
        }

        const db = drizzle(c.env.DB);
        const tenantId = c.get('tenantId') as string;
        await db.update(users)
            .set({ googleRefreshToken: refresh_token ?? null, googleCalendarId: calendarId })
            .where(and(eq(users.id, state), eq(users.tenantId, tenantId)));

        return c.redirect('/inspections?calendar=connected');
    });

export type CalendarApi = typeof calendarRoutes;

// createCalendarEvent / syncEventsToGcal moved to ../lib/google-calendar.
// Re-exported here so existing import paths (e.g. booking.service.ts importing
// createCalendarEvent from '../api/calendar') stay byte-identical.
export { createCalendarEvent, syncEventsToGcal };

export default calendarRoutes;
