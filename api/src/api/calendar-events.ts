import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { z } from '@hono/zod-openapi';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lt } from 'drizzle-orm';
import { inspections } from '../lib/db/schema/inspection';
import { users } from '../lib/db/schema/tenant';
import { requireRole } from '../lib/middleware/rbac';
import { logger } from '../lib/logger';
import { getCalendarEventStyle } from '../lib/calendar-event-style';
import { withMcpMetadata } from '../lib/route-metadata-standards';

const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

interface GoogleTokenResponse {
    access_token?: string;
    error?: string;
    error_description?: string;
}

interface GoogleEvent {
    id: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
}

async function refreshGoogleToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
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
    if (!res.ok || !data.access_token) {
        throw new Error(data.error_description ?? data.error ?? 'Token refresh failed');
    }
    return data.access_token;
}

const eventsRoute = createRoute(withMcpMetadata({
    method: 'get',
    path: '/',
    operationId: 'listCalendarEvents',
    tags: ['calendar'],
    summary: 'Get calendar events for FullCalendar',
    description: 'Returns combined calendar events (local inspections + Google Calendar busy blocks) in FullCalendar-compatible format. Used by the dashboard month/week views.',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
    request: {
        query: z.object({
            // Accept either YYYY-MM-DD (FullCalendar dayGridMonth view) or full ISO 8601
            start: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Expected date or ISO datetime').describe('Window start as YYYY-MM-DD or full ISO 8601 timestamp.'),
            end: z.string().regex(/^\d{4}-\d{2}-\d{2}/, 'Expected date or ISO datetime').describe('Window end (exclusive) as YYYY-MM-DD or full ISO 8601 timestamp.'),
        }).describe('TODO describe query field for the OpenInspection MCP integration'),
    },
    responses: {
        200: {
            content: { 'application/json': { schema: z.array(z.any()).describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Events array',
        },
        401: { description: 'Unauthorized' },
        403: { description: 'Forbidden' },
    },
    security: [{ bearerAuth: [] }],
}, { scopes: ['read'], tier: 'primary' }));

export const calendarEventsRoutes = createApiRouter()
    .openapi(eventsRoute, async (c) => {
    const { start, end } = c.req.valid('query');
    const tenantId = c.get('tenantId') as string;
    const jwtUser = c.get('user');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = drizzle(c.env.DB as any);

    // Local inspections — date is stored as 'YYYY-MM-DD' text
    const startDate = start.slice(0, 10);
    const endDate = end.slice(0, 10);

    const rows = await db
        .select()
        .from(inspections)
        .where(and(
            eq(inspections.tenantId, tenantId),
            gte(inspections.date, startDate),
            lt(inspections.date, endDate),
        ));

    const events: unknown[] = rows.map((r) => {
        // Iter-2 bug #5 — drafts must render on the calendar with a visual
        // pill so inspectors can see un-confirmed work without clicking
        // through. See src/lib/calendar-event-style.ts.
        const style = getCalendarEventStyle(r.status);
        return {
            id: r.id,
            title: `${style.titlePrefix}${r.propertyAddress}`,
            start: r.date,
            allDay: true,
            url: `/inspections/${r.id}/edit`,
            color: style.color,
            extendedProps: {
                source: 'local',
                status: r.status,
                isDraft: style.isDraft,
            },
        };
    });

    // Google Calendar events — best-effort; failures don't break local events
    if (jwtUser?.sub && c.env.GOOGLE_CLIENT_ID && c.env.GOOGLE_CLIENT_SECRET) {
        try {
            const userRows = await db
                .select()
                .from(users)
                .where(and(eq(users.id, jwtUser.sub), eq(users.tenantId, tenantId)))
                .limit(1);

            const userRow = userRows[0];
            if (userRow?.googleRefreshToken) {
                const cacheKey = `gcal_access:${jwtUser.sub}`;
                let accessToken: string | null = c.env.TENANT_CACHE
                    ? await c.env.TENANT_CACHE.get(cacheKey)
                    : null;
                if (!accessToken) {
                    accessToken = await refreshGoogleToken(
                        c.env.GOOGLE_CLIENT_ID,
                        c.env.GOOGLE_CLIENT_SECRET,
                        userRow.googleRefreshToken,
                    );
                    if (c.env.TENANT_CACHE) {
                        await c.env.TENANT_CACHE.put(cacheKey, accessToken, { expirationTtl: 3500 });
                    }
                }
                const calId = encodeURIComponent(userRow.googleCalendarId ?? 'primary');
                // Google API requires full RFC3339 timestamps. Convert YYYY-MM-DD inputs.
                const toRfc3339 = (s: string): string =>
                    /^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : new Date(s).toISOString();
                const params = new URLSearchParams({
                    timeMin: toRfc3339(start),
                    timeMax: toRfc3339(end),
                    singleEvents: 'true',
                    orderBy: 'startTime',
                });
                const gcalRes = await fetch(`${GOOGLE_CALENDAR_API}/calendars/${calId}/events?${params}`, {
                    headers: { Authorization: `Bearer ${accessToken}` },
                });
                if (gcalRes.ok) {
                    const gcalData = await gcalRes.json() as { items?: GoogleEvent[] };
                    for (const ev of gcalData.items ?? []) {
                        events.push({
                            id: `gcal-${ev.id}`,
                            title: ev.summary ?? '(No title)',
                            start: ev.start?.dateTime ?? ev.start?.date,
                            end: ev.end?.dateTime ?? ev.end?.date,
                            color: '#9CA3AF',
                            extendedProps: { source: 'google' },
                        });
                    }
                }
            }
        } catch (err) {
            logger.error('[calendar-events] Google Calendar fetch failed', {
                userId: jwtUser.sub,
            }, err instanceof Error ? err : undefined);
        }
    }

    return c.json(events);
});

export type CalendarEventsApi = typeof calendarEventsRoutes;

export default calendarEventsRoutes;
