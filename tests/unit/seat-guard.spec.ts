/**
 * Design System 0520 subsystem C phase 5 — seat-guard helpers.
 *
 * Unified seat quota: permanent members + active (non-expired) guests
 * all count uniformly against tenants.max_users. There is no separate
 * guest billing or role-based quota.
 */
import { describe, it, expect } from 'vitest';
import { computeSeatsUsed, isAtOrOverQuota } from '../../src/lib/middleware/seat-guard';

describe('seat-guard pure helpers (subsystem C P5)', () => {
    const NOW = 1_700_000_000;

    it('counts active permanent members (no expires_at)', () => {
        const users = [
            { id: 'u1', expiresAt: null },
            { id: 'u2', expiresAt: null },
        ];
        expect(computeSeatsUsed(users, NOW)).toBe(2);
    });

    it('counts active guests but excludes expired ones', () => {
        const users = [
            { id: 'u1', expiresAt: null },
            { id: 'g1', expiresAt: NOW + 100 },  // active
            { id: 'g2', expiresAt: NOW - 100 },  // expired
        ];
        expect(computeSeatsUsed(users, NOW)).toBe(2);
    });

    it('treats expires_at exactly equal to now as expired', () => {
        const users = [
            { id: 'g1', expiresAt: NOW },        // expired (boundary)
            { id: 'g2', expiresAt: NOW + 1 },    // active
        ];
        expect(computeSeatsUsed(users, NOW)).toBe(1);
    });

    it('handles undefined expires_at like null', () => {
        const users = [
            { id: 'u1' },                        // no expiresAt field
        ];
        expect(computeSeatsUsed(users, NOW)).toBe(1);
    });

    it('isAtOrOverQuota is uniform across roles', () => {
        expect(isAtOrOverQuota(3, 3)).toBe(true);
        expect(isAtOrOverQuota(3, 4)).toBe(false);
        expect(isAtOrOverQuota(4, 3)).toBe(true);
        expect(isAtOrOverQuota(0, 1)).toBe(false);
    });

    it('isAtOrOverQuota always blocks when maxUsers is 0', () => {
        expect(isAtOrOverQuota(0, 0)).toBe(true);
    });
});
