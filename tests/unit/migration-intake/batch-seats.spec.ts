/**
 * The whole-batch seat rule.
 *
 * All-or-nothing on purpose: a partial application means some people receive
 * an invitation email and others silently do not, and there is no view that
 * makes that state legible afterwards.
 *
 * The numbers are asserted, not just the throw/no-throw. A rule that refuses
 * the right batches while naming the wrong figures sends the operator to buy
 * the wrong number of seats.
 */
import { describe, it, expect } from 'vitest';
import { assertBatchSeatsAvailable, computeSeatsNeeded } from '../../../server/features/seat-quota/batch';
import type { SeatUsage } from '../../../server/features/seat-quota/usage';
import { AppError, ErrorCode } from '../../../server/lib/errors';

/**
 * 12 seats, 9 held, 3 free — and one of those 9 is an invitation nobody has
 * accepted. A batch is measured against seats HELD, so the pending invite is
 * part of what leaves only three.
 */
const usage = (over: Partial<SeatUsage> = {}): SeatUsage => ({
    used: 9, members: 8, max: 12, remaining: 3, pendingInvites: 1, ...over,
});

describe('computeSeatsNeeded', () => {
    it('counts only the member rows that would create somebody new', () => {
        expect(computeSeatsNeeded([
            { entity: 'member', conflictWith: null },
            { entity: 'member', conflictWith: 'existing-user' },
            { entity: 'member', conflictWith: null },
            { entity: 'contact', conflictWith: null },
        ])).toBe(2);
    });

    it('is zero for a batch with no member rows', () => {
        expect(computeSeatsNeeded([{ entity: 'template', conflictWith: null }])).toBe(0);
    });

    it('is zero for a batch of members who are all already here', () => {
        expect(computeSeatsNeeded([
            { entity: 'member', conflictWith: 'existing-user' },
            { entity: 'member', conflictWith: 'outstanding-invite' },
        ])).toBe(0);
    });
});

describe('assertBatchSeatsAvailable', () => {
    it('refuses the batch and names both numbers', () => {
        expect(() => assertBatchSeatsAvailable({
            needed: 12, usage: usage(), enforced: true, billingPortalUrl: null,
        })).toThrow(/needs 12 seats and 3 are available/);
    });

    it('carries the shortfall in the error details, not only in the sentence', () => {
        const err = (() => {
            try {
                assertBatchSeatsAvailable({
                    needed: 12, usage: usage(), enforced: true, billingPortalUrl: 'https://portal.example/billing',
                });
                return null;
            } catch (e) { return e; }
        })();
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).code).toBe(ErrorCode.SEAT_LIMIT_REACHED);
        expect((err as AppError).status).toBe(402);
        expect((err as AppError).details).toEqual({
            used: 9, max: 12, needed: 12, billingPortalUrl: 'https://portal.example/billing',
        });
    });

    it('refuses a batch one seat over, so the boundary is the boundary', () => {
        expect(() => assertBatchSeatsAvailable({
            needed: 4, usage: usage(), enforced: true, billingPortalUrl: null,
        })).toThrow(/needs 4 seats and 3 are available/);
    });

    it('allows a batch that exactly fills the remaining seats', () => {
        expect(() => assertBatchSeatsAvailable({
            needed: 3, usage: usage(), enforced: true, billingPortalUrl: null,
        })).not.toThrow();
    });

    it('counts the seats an unaccepted invitation is holding against the batch', () => {
        // Same tenant, same member count, one fewer outstanding invitation: the
        // extra headroom is exactly the invitation, and a batch of 4 fits where
        // it did not before. Without that seat in `remaining` the refusal above
        // would be measuring member rows and calling them seats.
        expect(() => assertBatchSeatsAvailable({
            needed: 4,
            usage: usage({ used: 8, pendingInvites: 0, remaining: 4 }),
            enforced: true,
            billingPortalUrl: null,
        })).not.toThrow();
    });

    it('short-circuits where the deployment has no seat quota', () => {
        expect(() => assertBatchSeatsAvailable({
            needed: 999, usage: usage(), enforced: false, billingPortalUrl: null,
        })).not.toThrow();
    });

    it('short-circuits for an unlimited tenant', () => {
        expect(() => assertBatchSeatsAvailable({
            needed: 999,
            usage: usage({ max: null, remaining: Number.POSITIVE_INFINITY }),
            enforced: true,
            billingPortalUrl: null,
        })).not.toThrow();
    });
});
