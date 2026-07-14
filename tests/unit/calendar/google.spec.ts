import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
    capabilityToScopes,
    capabilityFromScopes,
    canPushEvents,
    createPkceChallenge,
} from '../../../server/lib/calendar/provider';
import { getCalendarProvider } from '../../../server/lib/calendar/registry';
import { googleCalendarProvider } from '../../../server/lib/calendar/google';

describe('CalendarProvider — Google', () => {
    it('maps availability_read to freebusy/readonly scopes', () => {
        const scopes = capabilityToScopes('google', 'availability_read');
        expect(scopes).toContain('https://www.googleapis.com/auth/calendar.freebusy');
        expect(scopes).toContain('https://www.googleapis.com/auth/calendar.readonly');
    });

    it('maps events_read_write to calendar.events scope', () => {
        const scopes = capabilityToScopes('google', 'events_read_write');
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

    it('getAuthUrl includes PKCE challenge params', async () => {
        const pkce = await createPkceChallenge();
        const url = googleCalendarProvider.getAuthUrl({
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
            clientId: 'cid',
            clientSecret: 'sec',
            refreshToken: 'rt',
            calendarId: 'primary',
            range: { from: new Date('2026-07-14T00:00:00Z'), to: new Date('2026-07-15T00:00:00Z') },
            capability: 'availability_read',
        });

        expect(blocks).toHaveLength(1);
        expect(blocks[0].start).toBe('2026-07-14T10:00:00Z');
        const freeBusyCall = fetchMock.mock.calls[1];
        expect(String(freeBusyCall[0])).toContain('/freeBusy');
    });
});
