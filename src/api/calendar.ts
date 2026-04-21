import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { getCookie } from 'hono/cookie';
import { verify } from 'hono/jwt';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { users } from '../lib/db/schema/tenant';
import { availabilityOverrides } from '../lib/db/schema/inspection';
import { HonoConfig } from '../types/hono';
import { CalendarSyncResponseSchema, CalendarSuccessResponseSchema } from '../lib/validations/calendar.schema';

const calendarRoutes = new OpenAPIHono<HonoConfig>();

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

function getRedirectUri(baseUrl: string) {
    return `${baseUrl}/api/calendar/callback`;
}

interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    error_description?: string;
    error?: string;
}

interface GoogleCalendarResponse {
    id: string;
    [key: string]: unknown;
}

interface GoogleEvent {
    id: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
    const res = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
        }),
    });
    const data = await res.json() as GoogleTokenResponse;
    if (!res.ok) throw new Error(`Token refresh failed: ${data.error_description ?? data.error}`);
    return data.access_token;
}

/**
 * GET /api/calendar/connect
 * Redirects inspector to Google OAuth consent.
 */
calendarRoutes.get('/connect', async (c) => {
    if (!c.env.GOOGLE_CLIENT_ID) {
        return c.json({ error: 'Google Calendar integration is not configured' }, 501);
    }

    const token = getCookie(c, '__Host-inspector_token');
    if (!token) return c.redirect('/login');
    let payload: HonoConfig['Variables']['user'];
    try {
        payload = await verify(token, c.env.JWT_SECRET, 'HS256') as unknown as HonoConfig['Variables']['user'];
    } catch {
        return c.redirect('/login');
    }

    const baseUrl = c.env.APP_BASE_URL || `${new URL(c.req.url).protocol}//${c.req.header('host')}`;
    const state = payload.sub;

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
});

/**
 * GET /api/calendar/callback
 * Exchanges OAuth code and stores refresh token.
 */
calendarRoutes.get('/callback', async (c) => {
    const code = c.req.query('code');
    const state = c.req.query('state');
    const error = c.req.query('error');

    if (error) return c.html(`<p>Google Calendar authorization denied: ${error}. <a href="/dashboard">Back</a></p>`, 400);
    if (!code || !state) return c.json({ error: 'Missing code or state' }, 400);

    const baseUrl = c.env.APP_BASE_URL || `${new URL(c.req.url).protocol}//${c.req.header('host')}`;

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
        console.error('[calendar] Token exchange failed:', tokenData);
        return c.json({ error: 'Failed to exchange authorization code' }, 500);
    }

    const { refresh_token, access_token } = tokenData;

    const calRes = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
        headers: { 'Authorization': `Bearer ${access_token}` },
    });
    const calData = await calRes.json() as GoogleCalendarResponse;
    const calendarId = calData.id ?? 'primary';

    const db = drizzle(c.env.DB);
    await db.update(users)
        .set({ googleRefreshToken: refresh_token ?? null, googleCalendarId: calendarId })
        .where(eq(users.id, state));

    return c.redirect('/dashboard?calendar=connected');
});

/**
 * DELETE /api/calendar/disconnect
 * Removes stored Google tokens.
 */
const disconnectRoute = createRoute({
    method: 'delete',
    path: '/disconnect',
    tags: ['Calendar'],
    summary: 'Disconnect Google Calendar',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CalendarSuccessResponseSchema,
                },
            },
            description: 'Success',
        },
        401: { description: 'Unauthorized' }
    },
    security: [{ bearerAuth: [] }],
});

calendarRoutes.openapi(disconnectRoute, async (c) => {
    const token = getCookie(c, '__Host-inspector_token');
    if (!token) return c.json({ error: 'Not authenticated' }, 401);
    let payload: HonoConfig['Variables']['user'];
    try {
        payload = await verify(token, c.env.JWT_SECRET, 'HS256') as unknown as HonoConfig['Variables']['user'];
    } catch {
        return c.json({ error: 'Invalid token' }, 401);
    }

    const db = drizzle(c.env.DB);
    await db.update(users)
        .set({ googleRefreshToken: null, googleCalendarId: null })
        .where(eq(users.id, payload.sub));

    return c.json({ success: true, data: { success: true } }, 200);
});

/**
 * POST /api/calendar/sync
 * Pulls busy blocks from Google Calendar.
 */
const syncRoute = createRoute({
    method: 'post',
    path: '/sync',
    tags: ['Calendar'],
    summary: 'Sync Google Calendar events',
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CalendarSyncResponseSchema,
                },
            },
            description: 'Success',
        },
        400: { description: 'Calendar not connected' },
        401: { description: 'Unauthorized' },
        500: { description: 'Internal server error' }
    },
    security: [{ bearerAuth: [] }],
});

calendarRoutes.openapi(syncRoute, async (c) => {
    const token = getCookie(c, '__Host-inspector_token');
    if (!token) return c.json({ error: 'Not authenticated' }, 401);
    let payload: HonoConfig['Variables']['user'];
    try {
        payload = await verify(token, c.env.JWT_SECRET, 'HS256') as unknown as HonoConfig['Variables']['user'];
    } catch {
        return c.json({ error: 'Invalid token' }, 401);
    }

    const db = drizzle(c.env.DB);
    const userResult = await db.select().from(users).where(eq(users.id, payload.sub)).limit(1);
    const user = userResult[0];
    if (!user?.googleRefreshToken) {
        return c.json({ error: 'Google Calendar not connected' }, 400);
    }

    const accessToken = await refreshAccessToken(
        c.env.GOOGLE_CLIENT_ID,
        c.env.GOOGLE_CLIENT_SECRET,
        user.googleRefreshToken,
    );

    const timeMin = new Date().toISOString();
    const timeMax = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const eventsRes = await fetch(
        `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(user.googleCalendarId ?? 'primary')}/events?` +
        new URLSearchParams({ timeMin, timeMax, singleEvents: 'true', orderBy: 'startTime' }),
        { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );

    if (!eventsRes.ok) {
        const err = await eventsRes.json() as { error?: { message?: string } };
        return c.json({ error: 'Failed to fetch Google Calendar events', details: err.error?.message }, 500);
    }

    const eventsData = await eventsRes.json() as { items?: GoogleEvent[] };
    const events = eventsData.items ?? [];
    const tenantId = payload.tenantId;
    const inspectorId = payload.sub;
    let created = 0;

    for (const event of events) {
        if (!event.start?.date && !event.start?.dateTime) continue;
        const date = (event.start.date ?? event.start.dateTime?.slice(0, 10)) as string;

        const existing = await db.select({ id: availabilityOverrides.id })
            .from(availabilityOverrides)
            .where(and(
                eq(availabilityOverrides.inspectorId, inspectorId),
                eq(availabilityOverrides.date, date)
            ))
            .limit(1);
        if (existing.length) continue;

        await db.insert(availabilityOverrides).values({
            id: crypto.randomUUID(),
            tenantId: tenantId || user.tenantId,
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
});

/**
 * Create a Google Calendar event for a confirmed booking.
 */
export async function createCalendarEvent(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    calendarId: string,
    summary: string,
    date: string,
    address: string,
): Promise<void> {
    try {
        const accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);

        const start = new Date(date);
        const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);

        const eventRes = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
            {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    summary,
                    location: address,
                    start: { dateTime: start.toISOString() },
                    end: { dateTime: end.toISOString() },
                }),
            },
        );

        if (!eventRes.ok) {
            const err = await eventRes.json() as { error?: { message?: string } };
            console.error('[calendar] Failed to create event:', err.error?.message);
        }
    } catch (e) {
        console.error('[calendar] createCalendarEvent error:', e);
    }
}

export default calendarRoutes;
