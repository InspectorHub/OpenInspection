/**
 * Billing summary pure helper.
 *
 * The route handler in server/api/billing.ts is a thin wrapper around a tenant
 * read, `getSeatUsage`, and this pure aggregator. `summariseSeats` takes the
 * seat COUNT rather than the member rows — counting is `getSeatUsage`'s job and
 * only its job, because the route's own row query is where the missing
 * `deleted_at IS NULL` lived (see billing-summary-route.spec.ts). Every member
 * counts as one seat; `guests` is always 0 since the guest subsystem was
 * removed.
 */
import { describe, it, expect } from 'vitest';
import { summariseSeats } from '../../../server/lib/billing-summary';

describe('summariseSeats', () => {
    it('reports the seat count it is given; guests always 0', () => {
        const out = summariseSeats(3, { maxUsers: 5, tier: 'free' });
        expect(out).toEqual({
            tier:      'free',
            maxUsers:  5,
            seatsUsed: 3,
            permanent: 3,
            guests:    0,
        });
    });

    it('defaults missing tier to free and missing maxUsers to 1', () => {
        const out = summariseSeats(0, {});
        expect(out.tier).toBe('free');
        expect(out.maxUsers).toBe(1);
        expect(out.seatsUsed).toBe(0);
    });

    it('reports permanent equal to seatsUsed', () => {
        const out = summariseSeats(1, { maxUsers: 1, tier: 'free' });
        expect(out.permanent).toBe(1);
        expect(out.guests).toBe(0);
    });
});
