import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    canPushEvents,
    createPkceChallenge,
    ExternalEventGoneError,
} from '../../../server/lib/calendar/provider';
import type { CalendarAuth } from '../../../server/lib/calendar/provider';
import { getCalendarProvider } from '../../../server/lib/calendar/registry';
import {
    googleCalendarProvider,
    googleCapabilityScopes,
    capabilityFromScopes,
} from '../../../server/lib/calendar/google';

// One opaque provider-minted handle stands in for the three OAuth values the
// data plane used to take by hand.
const auth = {
    provider: 'google',
    material: { clientId: 'cid', clientSecret: 'sec', refreshToken: 'rt' },
} as CalendarAuth;

describe('CalendarProvider — Google', () => {
    it('maps availability_read to freebusy/readonly scopes', () => {
        const scopes = googleCapabilityScopes('availability_read');
        expect(scopes).toContain('https://www.googleapis.com/auth/calendar.freebusy');
        expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    });

    it('maps events_read_write to calendar.events scope', () => {
        const scopes = googleCapabilityScopes('events_read_write');
        expect(scopes).toEqual(['https://www.googleapis.com/auth/calendar.events']);
    });

    it('derives capability from granted scopes', () => {
        expect(capabilityFromScopes(['https://www.googleapis.com/auth/calendar.events']))
            .toBe('events_read_write');
        expect(capabilityFromScopes(['https://www.googleapis.com/auth/calendar.freebusy']))
            .toBe('availability_read');
    });

    it('gates push on events_read_write capability', () => {
        expect(canPushEvents('events_read_write')).toBe(true);
        expect(canPushEvents('availability_read')).toBe(false);
    });

    it('startConnect includes PKCE challenge params', async () => {
        const pkce = await createPkceChallenge();
        const url = googleCalendarProvider.startConnect!({
            clientId: 'cid',
            redirectUri: 'https://app.example/api/calendar/callback',
            state: 'user-1',
            pkce,
            capability: 'availability_read',
        });
        expect(url.searchParams.get('code_challenge')).toBe(pkce.challenge);
        expect(url.searchParams.get('code_challenge_method')).toBe('S256');
        expect(url.searchParams.get('scope')).toContain('calendar.freebusy');
    });

    it('registry returns the Google provider', () => {
        expect(getCalendarProvider('google').id).toBe('google');
    });
});

describe('googleCalendarProvider.listBusy', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn());
    });

    afterEach(() => {
        vi.stubGlobal('fetch', originalFetch);
    });

    it('calls freeBusy for availability_read capability', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                calendars: { primary: { busy: [{ start: '2026-07-14T10:00:00Z', end: '2026-07-14T11:00:00Z' }] } },
            }), { status: 200 }));

        const blocks = await googleCalendarProvider.listBusy({
            auth,
            calendarId: 'primary',
            range: { from: new Date('2026-07-14T00:00:00Z'), to: new Date('2026-07-15T00:00:00Z') },
            capability: 'availability_read',
        });

        expect(blocks).toHaveLength(1);
        expect(blocks[0].start).toBe('2026-07-14T10:00:00Z');
        const freeBusyCall = fetchMock.mock.calls[1];
        expect(String(freeBusyCall[0])).toContain('/freeBusy');
    });

    /**
     * The import rules are decided on fields the PARSER has to carry through.
     * A rule test that builds its own BusyBlock literals proves the rule, not
     * that the provider ever supplies what the rule reads.
     */
    it('carries recurringEventId and created/updated off the events endpoint', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({
                items: [{
                    id: 'inst-1',
                    recurringEventId: 'series-a',
                    created: '2026-05-01T00:00:00Z',
                    updated: '2026-06-02T00:00:00Z',
                    start: { dateTime: '2026-07-14T10:00:00Z' },
                    end: { dateTime: '2026-07-14T11:00:00Z' },
                }],
            }), { status: 200 }));

        const blocks = await googleCalendarProvider.listBusy({
            auth, calendarId: 'primary',
            range: { from: new Date('2026-07-14T00:00:00Z'), to: new Date('2026-07-15T00:00:00Z') },
            capability: 'events_read_write',
        });

        expect(blocks[0]).toMatchObject({
            externalId: 'inst-1',
            recurringEventId: 'series-a',
            createdMs: Date.parse('2026-05-01T00:00:00Z'),
            updatedMs: Date.parse('2026-06-02T00:00:00Z'),
        });
    });
});

/**
 * These assert the HTTP BODY, not the arguments handed to the provider. A test
 * that stubs the provider proves the caller passed `timeZone`; only this proves
 * Google is actually told about it. The two are not the same claim, and the
 * first one passes happily while the wire drops the field.
 */
describe('googleCalendarProvider write path — what goes on the wire', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => { vi.stubGlobal('fetch', vi.fn()); });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    const creds = { auth, calendarId: 'primary' };
    const event = {
        summary: 'Inspection: 1 Main St',
        location: '1 Main St',
        start: new Date('2026-06-01T13:30:00Z'),
        end: new Date('2026-06-01T15:30:00Z'),
        timeZone: 'America/New_York',
    };

    function bodyOf(call: unknown[]): Record<string, { timeZone?: string; dateTime?: string }> {
        return JSON.parse(String((call[1] as RequestInit).body));
    }

    it('pushEvent sends timeZone on both ends alongside the absolute instant', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gcal-1' }), { status: 200 }));

        const id = await googleCalendarProvider.pushEvent({ ...creds, event });
        expect(id).toBe('gcal-1');

        const body = bodyOf(fetchMock.mock.calls[1]);
        expect(body.start).toEqual({ dateTime: '2026-06-01T13:30:00.000Z', timeZone: 'America/New_York' });
        expect(body.end).toEqual({ dateTime: '2026-06-01T15:30:00.000Z', timeZone: 'America/New_York' });
    });

    it('patchEvent PATCHes the named event and carries the zone too', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'gcal-1' }), { status: 200 }));

        await googleCalendarProvider.patchEvent({ ...creds, externalId: 'gcal-1', event });

        const call = fetchMock.mock.calls[1];
        expect((call[1] as RequestInit).method).toBe('PATCH');
        expect(String(call[0])).toContain('/events/gcal-1');
        expect(bodyOf(call).start).toEqual({
            dateTime: '2026-06-01T13:30:00.000Z', timeZone: 'America/New_York',
        });
    });

    it('patchEvent reports a hand-deleted event as gone rather than as a failure', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response('{}', { status: 404 }));

        await expect(googleCalendarProvider.patchEvent({ ...creds, externalId: 'gone', event }))
            .rejects.toBeInstanceOf(ExternalEventGoneError);
    });

    it('omits timeZone entirely when the caller has no tenant zone', async () => {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'at' }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'g' }), { status: 200 }));

        const { timeZone: _drop, ...zoneless } = event;
        await googleCalendarProvider.pushEvent({ ...creds, event: zoneless });
        expect(bodyOf(fetchMock.mock.calls[1]).start).toEqual({ dateTime: '2026-06-01T13:30:00.000Z' });
    });
});
