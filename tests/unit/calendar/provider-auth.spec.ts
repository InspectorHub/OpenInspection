/**
 * `resolveAuth` is the seam that stops OAuth material leaking out of the Google
 * provider. These cases pin the two things that makes it worth having: what it
 * refuses to mint a handle for, and what happens when a handle is routed to the
 * wrong provider.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const resolveCreds = vi.fn();
vi.mock('../../../server/lib/calendar/resolve-google-oauth', () => ({
    loadGoogleOAuthMode: async () => 'platform',
    resolveGoogleOAuthCredentials: (...a: unknown[]) => resolveCreds(...a),
    isGoogleOAuthConfigured: async () => true,
}));

import { googleCalendarProvider } from '../../../server/lib/calendar/google';
import type { CalendarAuth, CalendarProviderEnv } from '../../../server/lib/calendar/provider';

const TENANT = '00000000-0000-0000-0000-000000000001';

const env = {
    DB: {} as D1Database,
    TENANT_CACHE: {} as unknown as KVNamespace,
    JWT_SECRET: 's',
} satisfies CalendarProviderEnv;

const OAUTH = { refreshToken: 'rt', scopes: ['https://www.googleapis.com/auth/calendar.events'] };

describe('googleCalendarProvider.resolveAuth', () => {
    beforeEach(() => {
        resolveCreds.mockReset().mockResolvedValue({ clientId: 'cid', clientSecret: 'sec' });
    });

    it('mints a handle stamped with its own provider id', async () => {
        const auth = await googleCalendarProvider.resolveAuth({
            tenantId: TENANT, credentials: OAUTH, env,
        });
        expect(auth).not.toBeNull();
        expect(auth!.provider).toBe('google');
    });

    /**
     * A deployment with no OAuth client is not a broken connection — it is
     * OAUTH_NOT_CONFIGURED, which the caller reports without logging an error.
     */
    it('returns null when no OAuth client resolves', async () => {
        resolveCreds.mockResolvedValue(null);
        expect(await googleCalendarProvider.resolveAuth({
            tenantId: TENANT, credentials: OAUTH, env,
        })).toBeNull();
    });

    it('returns null for a stored payload with an empty refresh token', async () => {
        expect(await googleCalendarProvider.resolveAuth({
            tenantId: TENANT, credentials: { refreshToken: '', scopes: [] }, env,
        })).toBeNull();
    });

    it('returns null when handed a CalDAV payload', async () => {
        expect(await googleCalendarProvider.resolveAuth({
            tenantId: TENANT,
            credentials: { username: 'a@icloud.com', appPassword: 'pw', url: 'https://caldav.icloud.com/' },
            env,
        })).toBeNull();
    });
});

describe('a handle minted by another provider', () => {
    /**
     * A mis-routed handle must be loud. Silently half-working is how a CalDAV
     * connection would end up making Google-shaped requests with no credentials.
     */
    it('makes listBusy throw rather than half-work', async () => {
        const foreign = { provider: 'apple', material: { username: 'a', password: 'b', homeUrl: 'c' } } as CalendarAuth;
        await expect(googleCalendarProvider.listBusy({
            auth: foreign,
            calendarId: 'primary',
            range: { from: new Date('2026-07-14T00:00:00Z'), to: new Date('2026-07-15T00:00:00Z') },
            capability: 'availability_read',
        })).rejects.toThrow(/apple|provider/i);
    });
});
