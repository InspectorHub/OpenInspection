/**
 * Design System 0520 subsystem C P9 T9.1 — billing summary pure helper.
 *
 * The route handler in server/api/billing.ts is a thin wrapper around two
 * drizzle queries + this pure aggregator. Splitting `summariseSeats`
 * out makes the seat-breakdown logic unit-testable without spinning a
 * full Hono context.
 */
import { describe, it, expect } from 'vitest';
import { summariseSeats } from '../../server/lib/billing-summary';

describe('summariseSeats (subsystem C P9.1)', () => {
    const NOW = 1_700_000_000;

    it('counts permanent + active guests, ignores expired', () => {
        const users = [
            { id: 'u1', expiresAt: null },                  // permanent
            { id: 'u2', expiresAt: null },                  // permanent
            { id: 'g1', expiresAt: NOW + 100 },             // active guest
            { id: 'g2', expiresAt: NOW - 100 },             // expired guest, excluded
        ];
        const out = summariseSeats(users, { maxUsers: 5, tier: 'free' }, NOW);
        expect(out).toEqual({
            tier:      'free',
            maxUsers:  5,
            seatsUsed: 3,
            permanent: 2,
            guests:    1,
        });
    });

    it('defaults missing tier to free and missing maxUsers to 1', () => {
        const out = summariseSeats([], {}, NOW);
        expect(out.tier).toBe('free');
        expect(out.maxUsers).toBe(1);
        expect(out.seatsUsed).toBe(0);
    });

    it('treats expiresAt exactly equal to now as expired (boundary)', () => {
        const users = [
            { id: 'g1', expiresAt: NOW },     // boundary → expired
            { id: 'g2', expiresAt: NOW + 1 }, // active
        ];
        const out = summariseSeats(users, { maxUsers: 3, tier: 'pro' }, NOW);
        expect(out.guests).toBe(1);
        expect(out.seatsUsed).toBe(1);
    });

    it('handles undefined expiresAt as permanent', () => {
        const users = [{ id: 'u1' }];
        const out = summariseSeats(users, { maxUsers: 1, tier: 'free' }, NOW);
        expect(out.permanent).toBe(1);
        expect(out.guests).toBe(0);
    });
});
