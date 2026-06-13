/**
 * seat-guard helpers.
 *
 * Seat quota: every member counts once against tenants.max_users.
 * There is no guest/expiry or role-based quota.
 */
import { describe, it, expect } from 'vitest';
import { computeSeatsUsed, isAtOrOverQuota } from '../../server/lib/middleware/seat-guard';

describe('seat-guard pure helpers', () => {
    it('counts every member once (no guest expiry semantics)', () => {
        expect(computeSeatsUsed([{ id: 'a' }, { id: 'b' }, { id: 'c' }])).toBe(3);
    });

    it('counts an empty member list as zero seats', () => {
        expect(computeSeatsUsed([])).toBe(0);
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
