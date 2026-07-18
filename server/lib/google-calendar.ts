/**
 * Google Calendar integration — OAuth token refresh + event push/sync.
 *
 * Extracted from server/api/calendar.ts (pure movement). The route handlers in
 * server/api/calendar.ts import these helpers; booking.service.ts imports
 * createCalendarEvent (re-exported from api/calendar.ts to keep its path stable).
 */

import { drizzle } from 'drizzle-orm/d1';
import { eq } from 'drizzle-orm';
import { logger } from './logger';

export const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GOOGLE_CALENDAR_API = 'https://www.googleapis.com/calendar/v3';

export function getRedirectUri(baseUrl: string) {
    return `${baseUrl}/api/calendar/callback`;
}

export interface GoogleTokenResponse {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    token_type: string;
    error_description?: string;
    error?: string;
}

export interface GoogleCalendarResponse {
    id: string;
    [key: string]: unknown;
}

export interface GoogleEvent {
    id: string;
    summary?: string;
    start?: { date?: string; dateTime?: string };
    end?: { date?: string; dateTime?: string };
    // 'transparent' = the event shows the owner as free (does not block).
    transparency?: string;
}

export async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
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
            logger.error('[calendar] Failed to create event', { detail: err.error?.message });
        }
    } catch (e) {
        logger.error('[calendar] createCalendarEvent error', {}, e instanceof Error ? e : undefined);
    }
}

/**
 * Spec 4D.T11 — Google Calendar sync for inspection events.
 *
 * Lists every inspection event in the next 90 days (via EventService.listEventsByDateRange)
 * and pushes each one as a separate calendar entry. Each event is summarised as
 * "<eventType.name> — <inspection.propertyAddress>" with start = scheduledAt and
 * end = scheduledAt + durationMin*60s.
 *
 * The function is best-effort: per-event push failures are logged but do not abort
 * the loop. A returned summary lets callers report counts back to the user. A future
 * enhancement should also persist a `gcalEventId` per inspection event so we can
 * update / delete the remote entry when status changes — see TODO below.
 */
export async function syncEventsToGcal(
    db: D1Database,
    tenantId: string,
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    calendarId: string,
): Promise<{ pushed: number; skipped: number; failed: number; totalEvents: number }> {
    if (!clientId || !clientSecret || !refreshToken) {
        logger.warn('[calendar] syncEventsToGcal missing credentials', { tenantId });
        return { pushed: 0, skipped: 0, failed: 0, totalEvents: 0 };
    }

    // Lazy import to avoid circular dependency between api/calendar.ts and services.
    const { EventService } = await import('../services/event.service');
    const { eventTypes, inspections, inspectionEvents } = await import('./db/schema');
    const eventService = new EventService(db);

    const fromTs = Date.now();
    const toTs   = fromTs + 90 * 24 * 60 * 60 * 1000;
    const events = await eventService.listEventsByDateRange(tenantId, fromTs, toTs);

    if (events.length === 0) {
        return { pushed: 0, skipped: 0, failed: 0, totalEvents: 0 };
    }

    let accessToken: string;
    try {
        accessToken = await refreshAccessToken(clientId, clientSecret, refreshToken);
    } catch (e) {
        logger.error('[calendar] syncEventsToGcal token refresh failed', { tenantId }, e instanceof Error ? e : undefined);
        return { pushed: 0, skipped: 0, failed: events.length, totalEvents: events.length };
    }

    // Pre-load event-type names + inspection addresses to avoid an N+1 fetch loop.
    const drizzleDb = drizzle(db);
    const allTypes = await drizzleDb.select({ id: eventTypes.id, name: eventTypes.name })
        .from(eventTypes).where(eq(eventTypes.tenantId, tenantId)).all();
    const typeNameById = new Map<string, string>(allTypes.map(t => [t.id as string, t.name as string]));
    const allInspections = await drizzleDb.select({ id: inspections.id, propertyAddress: inspections.propertyAddress })
        .from(inspections).where(eq(inspections.tenantId, tenantId)).all();
    const addressById = new Map<string, string>(allInspections.map(i => [i.id as string, (i.propertyAddress as string) || '']));

    let pushed = 0, skipped = 0, failed = 0;

    for (const ev of events) {
        // Skip cancelled / completed events — they shouldn't appear on the calendar.
        if (ev.status === 'cancelled' || ev.status === 'completed') {
            skipped++;
            continue;
        }
        // Idempotency: skip events already pushed (have gcal_event_id).
        // Use PATCH endpoint instead in future polish — for now skip to avoid duplicates.
        if (ev.gcalEventId) {
            skipped++;
            continue;
        }
        const typeName = typeNameById.get(ev.eventTypeId as string) || 'Inspection event';
        const address  = addressById.get(ev.inspectionId as string) || '';
        const summary  = address ? `${typeName} — ${address}` : typeName;
        const start    = new Date(ev.scheduledAt as Date);
        const durationSec = ((ev.durationMin as number | null) ?? 30) * 60;
        const end      = new Date(start.getTime() + durationSec * 1000);

        try {
            const res = await fetch(
                `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
                {
                    method: 'POST',
                    headers: {
                        'Authorization': `Bearer ${accessToken}`,
                        'Content-Type':  'application/json',
                    },
                    body: JSON.stringify({
                        summary,
                        location: address || undefined,
                        description: (ev.notes as string | null) || undefined,
                        start: { dateTime: start.toISOString() },
                        end:   { dateTime: end.toISOString() },
                    }),
                },
            );
            if (!res.ok) {
                const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
                logger.error('[calendar] Failed to push event', { eventId: ev.id, detail: err.error?.message });
                failed++;
                continue;
            }
            // Persist gcal_event_id for future PATCH/DELETE.
            const created = await res.json().catch(() => ({})) as { id?: string };
            if (created.id) {
                await drizzleDb.update(inspectionEvents)
                    .set({ gcalEventId: created.id })
                    .where(eq(inspectionEvents.id, ev.id as string));
            }
            pushed++;
        } catch (e) {
            logger.error('[calendar] syncEventsToGcal push error', { eventId: ev.id }, e instanceof Error ? e : undefined);
            failed++;
        }
    }

    logger.info('[calendar] syncEventsToGcal complete', { tenantId, pushed, skipped, failed, totalEvents: events.length });
    return { pushed, skipped, failed, totalEvents: events.length };
}
