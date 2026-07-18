import {
    GOOGLE_AUTH_URL,
    GOOGLE_TOKEN_URL,
    GOOGLE_CALENDAR_API,
    refreshAccessToken,
    type GoogleTokenResponse,
    type GoogleCalendarResponse,
    type GoogleEvent,
} from '../google-calendar';
import { capabilityToScopes } from './provider';
import type { CalendarProvider, OAuthExchangeResult, BusyBlock, CalendarListEntry } from './provider';

function toRfc3339(d: Date): string {
    return d.toISOString();
}

async function accessTokenFor(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
): Promise<string> {
    return refreshAccessToken(clientId, clientSecret, refreshToken);
}

export const googleCalendarProvider: CalendarProvider = {
    id: 'google',
    authType: 'oauth',

    getAuthUrl({ clientId, redirectUri, state, pkce, capability }) {
        const params = new URLSearchParams({
            client_id: clientId,
            redirect_uri: redirectUri,
            response_type: 'code',
            scope: capabilityToScopes('google', capability).join(' '),
            access_type: 'offline',
            prompt: 'consent',
            state,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
        });
        return new URL(`${GOOGLE_AUTH_URL}?${params}`);
    },

    async exchangeCode({ clientId, clientSecret, redirectUri, code, verifier }): Promise<OAuthExchangeResult> {
        const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: clientId,
                client_secret: clientSecret,
                redirect_uri: redirectUri,
                grant_type: 'authorization_code',
                code_verifier: verifier,
            }),
        });
        const tokenData = await tokenRes.json() as GoogleTokenResponse & { scope?: string };
        if (!tokenRes.ok) {
            throw new Error(tokenData.error_description ?? tokenData.error ?? 'Token exchange failed');
        }
        const accessToken = tokenData.access_token;
        const calRes = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList/primary`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        const calData = await calRes.json() as GoogleCalendarResponse;
        const expiresAt = tokenData.expires_in
            ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
            : undefined;
        const scopes = (tokenData.scope ?? '').split(' ').filter(Boolean);
        return {
            credentials: {
                refreshToken: tokenData.refresh_token ?? '',
                ...(accessToken ? { accessToken } : {}),
                ...(expiresAt ? { expiresAt } : {}),
            },
            scopes,
            calendarId: calData.id ?? 'primary',
        };
    },

    async listBusy({ clientId, clientSecret, refreshToken, calendarId, range, capability }): Promise<BusyBlock[]> {
        const accessToken = await accessTokenFor(clientId, clientSecret, refreshToken);
        if (capability === 'availability_read') {
            const res = await fetch(`${GOOGLE_CALENDAR_API}/freeBusy`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    timeMin: toRfc3339(range.from),
                    timeMax: toRfc3339(range.to),
                    items: [{ id: calendarId }],
                }),
            });
            if (!res.ok) throw new Error('Failed to fetch Google Calendar freeBusy');
            const data = await res.json() as { calendars?: Record<string, { busy?: { start: string; end: string }[] }> };
            const busy = data.calendars?.[calendarId]?.busy ?? [];
            return busy.map((b) => ({ start: b.start, end: b.end }));
        }

        const eventsRes = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events?` +
            new URLSearchParams({
                timeMin: toRfc3339(range.from),
                timeMax: toRfc3339(range.to),
                singleEvents: 'true',
                orderBy: 'startTime',
            }),
            { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        if (!eventsRes.ok) throw new Error('Failed to fetch Google Calendar events');
        const eventsData = await eventsRes.json() as { items?: GoogleEvent[] };
        const blocks: BusyBlock[] = [];
        for (const event of eventsData.items ?? []) {
            const start = event.start?.dateTime ?? (event.start?.date ? `${event.start.date}T00:00:00.000Z` : null);
            const end = event.end?.dateTime ?? (event.end?.date ? `${event.end.date}T23:59:59.000Z` : null);
            if (start && end) {
                blocks.push({
                    start,
                    end,
                    externalId: event.id,
                    transparency: event.transparency === 'transparent' ? 'transparent' : 'opaque',
                });
            }
        }
        return blocks;
    },

    async listCalendars({ clientId, clientSecret, refreshToken }): Promise<CalendarListEntry[]> {
        const accessToken = await accessTokenFor(clientId, clientSecret, refreshToken);
        const res = await fetch(`${GOOGLE_CALENDAR_API}/users/me/calendarList`, {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!res.ok) throw new Error('Failed to fetch Google calendar list');
        const data = await res.json() as {
            items?: Array<{ id?: string; summary?: string; accessRole?: string; primary?: boolean }>;
        };
        return (data.items ?? [])
            .filter((c) => Boolean(c.id))
            .map((c) => ({
                id: c.id!,
                summary: c.summary ?? c.id!,
                accessRole: c.accessRole ?? 'reader',
                primary: c.primary === true,
            }));
    },

    async pushEvent({ clientId, clientSecret, refreshToken, calendarId, event }): Promise<string> {
        const accessToken = await accessTokenFor(clientId, clientSecret, refreshToken);
        const res = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    summary: event.summary,
                    location: event.location,
                    description: event.description,
                    start: { dateTime: event.start.toISOString() },
                    end: { dateTime: event.end.toISOString() },
                }),
            },
        );
        if (!res.ok) {
            const err = await res.json().catch(() => ({})) as { error?: { message?: string } };
            throw new Error(err.error?.message ?? 'Failed to push calendar event');
        }
        const created = await res.json() as { id?: string };
        if (!created.id) throw new Error('Google Calendar did not return an event id');
        return created.id;
    },

    async deleteEvent({ clientId, clientSecret, refreshToken, calendarId, externalId }): Promise<void> {
        const accessToken = await accessTokenFor(clientId, clientSecret, refreshToken);
        const res = await fetch(
            `${GOOGLE_CALENDAR_API}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(externalId)}`,
            {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${accessToken}` },
            },
        );
        if (!res.ok && res.status !== 404) {
            throw new Error('Failed to delete Google Calendar event');
        }
    },
};
