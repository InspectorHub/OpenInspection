/**
 * Billing summary pure helper.
 *
 * The route handler in server/api/billing.ts is a thin wrapper around two
 * drizzle queries + this pure aggregator. Splitting `summariseSeats`
 * out makes the seat-breakdown logic unit-testable without spinning a
 * full Hono context. Every member counts as one seat; `guests` is always
 * 0 since the guest subsystem was removed.
 */
import { describe, it, expect } from 'vitest';
import { summariseSeats } from '../../../server/lib/billing-summary';

describe('summariseSeats', () => {
    it('counts every member once; guests always 0', () => {
        const users = [{ id: 'u1' }, { id: 'u2' }, { id: 'u3' }];
        const out = summariseSeats(users, { maxUsers: 5, tier: 'free' });
        expect(out).toEqual({
            tier:      'free',
            maxUsers:  5,
            seatsUsed: 3,
            permanent: 3,
            guests:    0,
        });
    });

    it('defaults missing tier to free and missing maxUsers to 1', () => {
        const out = summariseSeats([], {});
        expect(out.tier).toBe('free');
        expect(out.maxUsers).toBe(1);
        expect(out.seatsUsed).toBe(0);
    });

    it('reports permanent equal to seatsUsed', () => {
        const out = summariseSeats([{ id: 'u1' }], { maxUsers: 1, tier: 'free' });
        expect(out.permanent).toBe(1);
        expect(out.guests).toBe(0);
    });
});
