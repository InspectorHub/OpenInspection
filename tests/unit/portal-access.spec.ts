import { describe, it, expect } from 'vitest';
import { resolvePortalAccess } from '../../server/lib/public-access';

const live = { inspectionId: 'insp1', tenantId: 't1', role: 'client' as const, recipientEmail: 'a@b.com', revokedAt: null, expiresAt: null };

describe('resolvePortalAccess', () => {
    it('null when no token', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => live }, undefined, 'insp1')).toBeNull();
    });
    it('null when token unknown', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => null }, 'x', 'insp1')).toBeNull();
    });
    it('null when token maps to a different inspection', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, inspectionId: 'other' }) }, 'x', 'insp1')).toBeNull();
    });
    it('null when revoked', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, revokedAt: 1 }) }, 'x', 'insp1')).toBeNull();
    });
    it('null when expired', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => ({ ...live, expiresAt: 1 }) }, 'x', 'insp1', 2)).toBeNull();
    });
    it('returns {tenantId, role, recipientEmail} when live + matching', async () => {
        expect(await resolvePortalAccess({ resolveToken: async () => live }, 'x', 'insp1', 0)).toEqual({
            tenantId: 't1', role: 'client', recipientEmail: 'a@b.com',
        });
    });
});
