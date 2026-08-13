/**
 * The parity instrument.
 *
 * This file records what every Google calendar operation actually puts on the
 * wire, driven through `getCalendarProvider()` so the registry, the interface
 * and the implementation are all inside the recording. It exists so that
 * "the provider-interface refactor preserved behaviour" is a demonstrated claim
 * rather than an asserted one: after the refactor every `expect(...)` here must
 * be byte-identical, and only the lines that CONSTRUCT the provider argument
 * may differ.
 *
 * Assertions use `toEqual` on the whole request shape on purpose. A partial
 * match cannot notice a field the refactor silently drops.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Argument construction only: the handle the data plane now takes is minted by
// the provider, and minting it needs an OAuth client to resolve.
vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    loadGoogleOAuthMode: async () => 'platform',
    resolveGoogleOAuthCredentials: async () => ({ clientId: 'cid', clientSecret: 'sec' }),
    isGoogleOAuthConfigured: async () => true,
}));

import { getCalendarProvider } from '../../../server/lib/calendar/registry';
import { ExternalEventGoneError } from '../../../server/lib/calendar/provider';
import type { CalendarAuth } from '../../../server/lib/calendar/provider';

const CALENDAR_API = 'https://www.googleapis.com/calendar/v3';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let AUTH: { auth: CalendarAuth };

interface RequestShape {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: string | null;
}

/**
 * The full outgoing request, with the `Authorization` VALUE redacted while its
 * presence stays asserted — a recording of a credential is not a recording
 * anyone should keep in a repo.
 */
function requestShape(call: unknown[]): RequestShape {
    const init = (call[1] ?? {}) as RequestInit;
    const headers: Record<string, string> = {};
    new Headers(init.headers as HeadersInit | undefined).forEach((value, key) => {
        headers[key] = key === 'authorization' ? '<redacted>' : value;
    });
    return {
        method: init.method ?? 'GET',
        url: String(call[0]),
        headers,
        body: init.body == null ? null : String(init.body),
    };
}

/** The token refresh that precedes every data-plane call. Pinned only as "a POST to the token URL". */
function expectTokenRefresh(call: unknown[]): void {
    expect(String(call[0])).toBe(TOKEN_URL);
    expect(((call[1] ?? {}) as RequestInit).method).toBe('POST');
}

const RANGE = {
    from: new Date('2026-07-14T00:00:00.000Z'),
    to: new Date('2026-07-15T00:00:00.000Z'),
};

const EVENT = {
    summary: 'Inspection: 1 Main St',
    location: '1 Main St',
    description: 'Full home inspection',
    start: new Date('2026-06-01T13:30:00.000Z'),
    end: new Date('2026-06-01T15:30:00.000Z'),
    timeZone: 'America/New_York',
};

const EVENT_BODY = JSON.stringify({
    summary: 'Inspection: 1 Main St',
    location: '1 Main St',
    description: 'Full home inspection',
    start: { dateTime: '2026-06-01T13:30:00.000Z', timeZone: 'America/New_York' },
    end: { dateTime: '2026-06-01T15:30:00.000Z', timeZone: 'America/New_York' },
});

describe('Google provider — wire parity', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(async () => {
        const auth = await getCalendarProvider('google').resolveAuth({
            tenantId: '00000000-0000-0000-0000-000000000001',
            credentials: { refreshToken: 'rt', scopes: [] },
            env: {
                DB: {} as D1Database,
                TENANT_CACHE: {} as unknown as KVNamespace,
                JWT_SECRET: 's',
            },
        });
        AUTH = { auth: auth! };
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    function tokenThen(...responses: Response[]) {
        const fetchMock = vi.mocked(fetch);
        fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }));
        for (const res of responses) fetchMock.mockResolvedValueOnce(res);
        return fetchMock;
    }

    it('listBusy in availability_read mode POSTs the freeBusy endpoint', async () => {
        const fetchMock = tokenThen(new Response(JSON.stringify({
            calendars: { primary: { busy: [{ start: '2026-07-14T10:00:00Z', end: '2026-07-14T11:00:00Z' }] } },
        }), { status: 200 }));

        const blocks = await getCalendarProvider('google').listBusy({
            ...AUTH,
            calendarId: 'primary',
            range: RANGE,
            capability: 'availability_read',
        });

        expect(blocks).toEqual([{ start: '2026-07-14T10:00:00Z', end: '2026-07-14T11:00:00Z' }]);
        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'POST',
            url: `${CALENDAR_API}/freeBusy`,
            headers: {
                'authorization': '<redacted>',
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                timeMin: '2026-07-14T00:00:00.000Z',
                timeMax: '2026-07-15T00:00:00.000Z',
                items: [{ id: 'primary' }],
            }),
        });
    });

    it('listBusy in events_read_write mode GETs the events endpoint and carries the import fields through', async () => {
        const fetchMock = tokenThen(new Response(JSON.stringify({
            items: [{
                id: 'inst-1',
                recurringEventId: 'series-a',
                created: '2026-05-01T00:00:00Z',
                updated: '2026-06-02T00:00:00Z',
                transparency: 'transparent',
                start: { dateTime: '2026-07-14T10:00:00Z' },
                end: { dateTime: '2026-07-14T11:00:00Z' },
            }],
        }), { status: 200 }));

        const blocks = await getCalendarProvider('google').listBusy({
            ...AUTH,
            calendarId: 'me@example.com',
            range: RANGE,
            capability: 'events_read_write',
        });

        expect(blocks).toEqual([{
            start: '2026-07-14T10:00:00Z',
            end: '2026-07-14T11:00:00Z',
            externalId: 'inst-1',
            transparency: 'transparent',
            recurringEventId: 'series-a',
            createdMs: Date.parse('2026-05-01T00:00:00Z'),
            updatedMs: Date.parse('2026-06-02T00:00:00Z'),
        }]);
        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'GET',
            url: `${CALENDAR_API}/calendars/me%40example.com/events?`
                + 'timeMin=2026-07-14T00%3A00%3A00.000Z'
                + '&timeMax=2026-07-15T00%3A00%3A00.000Z'
                + '&singleEvents=true'
                + '&orderBy=startTime',
            headers: { 'authorization': '<redacted>' },
            body: null,
        });
    });

    it('listCalendars GETs the calendarList endpoint', async () => {
        const fetchMock = tokenThen(new Response(JSON.stringify({
            items: [{ id: 'primary', summary: 'Personal', accessRole: 'owner', primary: true }],
        }), { status: 200 }));

        const calendars = await getCalendarProvider('google').listCalendars({ ...AUTH });

        expect(calendars).toEqual([
            { id: 'primary', summary: 'Personal', accessRole: 'owner', primary: true },
        ]);
        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'GET',
            url: `${CALENDAR_API}/users/me/calendarList`,
            headers: { 'authorization': '<redacted>' },
            body: null,
        });
    });

    it('pushEvent POSTs the event body to the calendar', async () => {
        const fetchMock = tokenThen(new Response(JSON.stringify({ id: 'gcal-1' }), { status: 200 }));

        const id = await getCalendarProvider('google').pushEvent({
            ...AUTH, calendarId: 'primary', event: EVENT,
        });

        expect(id).toBe('gcal-1');
        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'POST',
            url: `${CALENDAR_API}/calendars/primary/events`,
            headers: {
                'authorization': '<redacted>',
                'content-type': 'application/json',
            },
            body: EVENT_BODY,
        });
    });

    it('patchEvent PATCHes the named event', async () => {
        const fetchMock = tokenThen(new Response(JSON.stringify({ id: 'gcal-1' }), { status: 200 }));

        await getCalendarProvider('google').patchEvent({
            ...AUTH, calendarId: 'primary', externalId: 'gcal-1', event: EVENT,
        });

        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'PATCH',
            url: `${CALENDAR_API}/calendars/primary/events/gcal-1`,
            headers: {
                'authorization': '<redacted>',
                'content-type': 'application/json',
            },
            body: EVENT_BODY,
        });
    });

    it('deleteEvent DELETEs the named event with no body', async () => {
        const fetchMock = tokenThen(new Response(null, { status: 204 }));

        await getCalendarProvider('google').deleteEvent({
            ...AUTH, calendarId: 'primary', externalId: 'gcal-1',
        });

        expectTokenRefresh(fetchMock.mock.calls[0]);
        expect(requestShape(fetchMock.mock.calls[1])).toEqual({
            method: 'DELETE',
            url: `${CALENDAR_API}/calendars/primary/events/gcal-1`,
            headers: { 'authorization': '<redacted>' },
            body: null,
        });
    });

    it('patchEvent rejects with ExternalEventGoneError on 404', async () => {
        tokenThen(new Response('{}', { status: 404 }));

        await expect(getCalendarProvider('google').patchEvent({
            ...AUTH, calendarId: 'primary', externalId: 'gone', event: EVENT,
        })).rejects.toBeInstanceOf(ExternalEventGoneError);
    });
});
