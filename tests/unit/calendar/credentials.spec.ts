import { describe, it, expect } from 'vitest';
import { sealCredentials, openCredentials } from '../../../server/lib/calendar/credentials';

const TENANT = 'tenant-cal-1';
const SECRET = 'jwt-secret-for-calendar-test';

describe('calendar credentials envelope', () => {
    it('round-trips an OAuth credential envelope', async () => {
        const payload = { refreshToken: 'super-secret-refresh-token-xyz', scopes: ['https://www.googleapis.com/auth/calendar.events'] };
        const enc = await sealCredentials(payload, TENANT, SECRET);
        expect(enc.credentialsEnc).not.toContain('super-secret-refresh-token-xyz');
        expect(enc.credentialsDekEnc.startsWith('k1:')).toBe(true);
        expect(await openCredentials(enc.credentialsEnc, enc.credentialsDekEnc, TENANT, SECRET)).toEqual(payload);
    });

    it('round-trips optional OAuth access token fields', async () => {
        const payload = {
            refreshToken: 'refresh',
            accessToken: 'access',
            expiresAt: '2026-07-14T12:00:00.000Z',
            scopes: ['calendar.freebusy', 'calendar.readonly'],
        };
        const enc = await sealCredentials(payload, TENANT, SECRET);
        expect(await openCredentials(enc.credentialsEnc, enc.credentialsDekEnc, TENANT, SECRET)).toEqual(payload);
    });

    it('binds ciphertext to tenant — transplant fails', async () => {
        const enc = await sealCredentials({ refreshToken: 'r', scopes: ['events'] }, TENANT, SECRET);
        await expect(openCredentials(enc.credentialsEnc, enc.credentialsDekEnc, 'other-tenant', SECRET))
            .rejects.toThrow();
    });
});

/**
 * iCloud authenticates on the Apple ID, so the CalDAV member needs somewhere to
 * put it. Encoding it into `url` would give that field a second meaning.
 */
describe('CalDAV credential envelope', () => {
    it('round-trips username, app password and url', async () => {
        const payload = {
            username: 'inspector@icloud.com',
            appPassword: 'abcd-efgh-ijkl-mnop',
            url: 'https://p42-caldav.icloud.com/1234567/calendars/',
        };
        const enc = await sealCredentials(payload, TENANT, SECRET);
        expect(await openCredentials(enc.credentialsEnc, enc.credentialsDekEnc, TENANT, SECRET))
            .toEqual(payload);
    });

    it('does not store the app password in the clear', async () => {
        const payload = {
            username: 'inspector@icloud.com',
            appPassword: 'abcd-efgh-ijkl-mnop',
            url: 'https://p42-caldav.icloud.com/1234567/calendars/',
        };
        const enc = await sealCredentials(payload, TENANT, SECRET);
        expect(enc.credentialsEnc).not.toContain('abcd-efgh-ijkl-mnop');
        expect(enc.credentialsEnc).not.toContain('inspector@icloud.com');
    });

    /**
     * The discriminator must stay `appPassword && url`. If it depended on
     * `username`, a row sealed before the field existed would decode as an OAuth
     * payload carrying an empty refresh token — a shape nothing can use and
     * nothing would flag.
     */
    it('decodes a legacy record with no username as CalDAV, not OAuth', async () => {
        const legacy = { appPassword: 'pw-only', url: 'https://caldav.icloud.com/' } as unknown as Parameters<typeof sealCredentials>[0];
        const enc = await sealCredentials(legacy, TENANT, SECRET);
        const opened = await openCredentials(enc.credentialsEnc, enc.credentialsDekEnc, TENANT, SECRET);
        expect(opened).toEqual({ username: '', appPassword: 'pw-only', url: 'https://caldav.icloud.com/' });
        expect('refreshToken' in opened).toBe(false);
    });
});
