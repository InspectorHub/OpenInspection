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
