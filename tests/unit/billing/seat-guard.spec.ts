/**
 * seat-guard helpers.
 *
 * Seat quota: every member counts once against tenants.max_users.
 * There is no guest/expiry or role-based quota.
 */
import { describe, it, expect } from 'vitest';
import { computeSeatsUsed, computeSeatsHeld, isAtOrOverQuota } from '../../../server/lib/middleware/seat-guard';

describe('seat-guard pure helpers', () => {
    it('counts every member once (no guest expiry semantics)', () => {
        expect(computeSeatsUsed([{ id: 'a', role: 'owner' }, { id: 'b', role: 'inspector' }, { id: 'c', role: 'manager' }])).toBe(3);
    });

    it('does not count a staff member, and counts the same people as before without one (control)', () => {
        const withStaff = [{ id: 'a', role: 'owner' }, { id: 'b', role: 'staff' }, { id: 'c', role: 'staff' }] as const;
        expect(computeSeatsUsed([...withStaff])).toBe(1);
        expect(computeSeatsUsed(withStaff.filter((u) => u.role !== 'staff'))).toBe(1);
    });

    it('computeSeatsHeld applies the same rule to outstanding invites', () => {
        const members = [{ id: 'a', role: 'owner' }, { id: 'b', role: 'staff' }] as const;
        const invites = [{ id: 'i1', role: 'staff' }, { id: 'i2', role: 'inspector' }, { id: 'i3', role: 'manager' }] as const;
        expect(computeSeatsHeld([...members], [...invites])).toBe(3);
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
