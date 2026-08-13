/**
 * Connect is a provider-chosen flow.
 *
 * `getAuthUrl` + `exchangeCode` named OAuth's two halves on an interface a
 * CalDAV provider has to implement. `connectFlow` + `startConnect` +
 * `completeConnect` is the shape both can express: OAuth navigates a popup and
 * comes back with a code, CalDAV collects a form and never opens one.
 */
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

const resolveCreds = vi.fn();
vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    loadGoogleOAuthMode: async () => 'platform',
    resolveGoogleOAuthCredentials: (...a: unknown[]) => resolveCreds(...a),
    isGoogleOAuthConfigured: async () => true,
}));

import { googleCalendarProvider } from '../../../server/lib/calendar/google';
import { createPkceChallenge } from '../../../server/lib/calendar/provider';
import type { CalendarProviderEnv } from '../../../server/lib/calendar/provider';

const TENANT = '00000000-0000-0000-0000-000000000001';

const env = {
    DB: {} as D1Database,
    TENANT_CACHE: {} as unknown as KVNamespace,
    JWT_SECRET: 's',
} satisfies CalendarProviderEnv;

describe('googleCalendarProvider — connect flow', () => {
    const originalFetch = globalThis.fetch;

    beforeEach(() => {
        resolveCreds.mockReset().mockResolvedValue({ clientId: 'cid', clientSecret: 'sec' });
        vi.stubGlobal('fetch', vi.fn());
    });
    afterEach(() => { vi.stubGlobal('fetch', originalFetch); });

    it('drives connect by redirect', () => {
        expect(googleCalendarProvider.connectFlow).toEqual({ kind: 'redirect' });
    });

    /**
     * Copied verbatim out of google.spec.ts so the two agree: the rename from
     * getAuthUrl must not change one byte of the consent URL.
     */
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

    function tokenResponse(body: Record<string, unknown>) {
        const fetchMock = vi.mocked(fetch);
        fetchMock
            .mockResolvedValueOnce(new Response(JSON.stringify(body), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'me@example.com' }), { status: 200 }));
        return fetchMock;
    }

    const submission = {
        kind: 'oauth_code',
        code: 'the-code',
        verifier: 'the-verifier',
        redirectUri: 'https://app.example/api/calendar/callback',
    } as const;

    /**
     * For an OAuth provider the capability is DERIVED: it is what the server
     * actually granted, not what we asked for.
     */
    it('derives the capability from the granted scopes', async () => {
        tokenResponse({
            access_token: 'at',
            refresh_token: 'rt',
            expires_in: 3600,
            scope: 'https://www.googleapis.com/auth/calendar.events',
        });

        const result = await googleCalendarProvider.completeConnect({
            tenantId: TENANT, env, submission, requestedCapability: 'availability_read',
        });

        expect(result.capability).toBe('events_read_write');
        expect(result.authType).toBe('oauth');
        expect(result.calendarId).toBe('me@example.com');
        expect(result.credentials).toMatchObject({
            refreshToken: 'rt',
            scopes: ['https://www.googleapis.com/auth/calendar.events'],
        });
    });

    it('falls back to the requested capability when the token response carries no scope', async () => {
        tokenResponse({ access_token: 'at', refresh_token: 'rt', expires_in: 3600 });

        const result = await googleCalendarProvider.completeConnect({
            tenantId: TENANT, env, submission, requestedCapability: 'events_read_write',
        });

        expect(result.capability).toBe('events_read_write');
    });

    it('rejects a token response with no refresh token', async () => {
        tokenResponse({ access_token: 'at', expires_in: 3600, scope: 'calendar.events' });

        await expect(googleCalendarProvider.completeConnect({
            tenantId: TENANT, env, submission, requestedCapability: 'events_read_write',
        })).rejects.toThrow(/refresh token/i);
    });
});
