/**
 * The cancellation ladder, as a table of cases.
 *
 * Two invariants carry the weight here and both have a case that would pass
 * under the wrong reading:
 *
 *  - the inspector exception (a full refund regardless of notice, not
 *    configurable), and
 *  - the fee base: a PERCENT fee is of the PRICE, but only what was COLLECTED
 *    can be kept. Every case where price == paid is blind to that distinction,
 *    so the cases below deliberately separate them.
 */
import { describe, it, expect } from 'vitest';
import { resolveCancellation } from '../../../server/lib/billing/cancellation-outcome';
import type { CancellationPolicy } from '../../../server/lib/billing/cancellation-policy';

const POLICY: CancellationPolicy = {
    noticeHours: 24,
    lateFee: { type: 'percent', percent: 50 },
    noShowFee: { type: 'percent', percent: 100 },
    remedy: 'refund',
};

const NOW = Date.UTC(2026, 7, 6, 12, 0, 0);
const h = (n: number) => NOW + n * 3_600_000;

/** Price and paid equal unless a case says otherwise. */
const at = (
    scheduledAt: number | null,
    over: Partial<Parameters<typeof resolveCancellation>[0]> = {},
) => resolveCancellation({
    policy: POLICY,
    scheduledAt,
    now: NOW,
    priceCents: 45000,
    paidCents: 45000,
    initiator: 'client',
    event: 'cancellation',
    ...over,
});

describe('resolveCancellation', () => {
    it('refunds in full with sufficient notice', () => {
        expect(at(h(48))).toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'sufficient_notice' });
    });

    it('treats notice exactly at the threshold as sufficient', () => {
        // The boundary belongs to the client. A policy saying "24 hours notice"
        // is read by everyone as "24 hours is enough", and the alternative
        // charges someone for being punctual to the minute.
        expect(at(h(24))).toMatchObject({ feeCents: 0, reason: 'sufficient_notice' });
    });

    it('keeps the late fee inside the notice window', () => {
        expect(at(h(12))).toMatchObject({ feeCents: 22500, refundCents: 22500, reason: 'late_cancellation' });
    });

    it('keeps the no-show fee', () => {
        expect(at(h(-24), { event: 'no_show' }))
            .toMatchObject({ feeCents: 45000, refundCents: 0, reason: 'no_show' });
    });

    it('charges the no-show fee even when the notice window was never breached', () => {
        // A no-show is an EVENT, not a notice failure — this is why the input
        // splits initiator from event instead of carrying `by: 'no_show'`,
        // which cannot express "the client no-showed" at all.
        expect(at(h(48), { event: 'no_show' })).toMatchObject({ feeCents: 45000, reason: 'no_show' });
    });

    it('ALWAYS refunds in full when the inspector cancels, inside the window or not', () => {
        expect(at(h(1), { initiator: 'inspector' }))
            .toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'inspector_initiated' });
    });

    it('refunds in full when the inspector is the reason for a no-show', () => {
        expect(at(h(-1), { initiator: 'inspector', event: 'no_show' }))
            .toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'inspector_initiated' });
    });

    it('charges a percentage of the PRICE, not of what was collected', () => {
        // 50% of a 45000 price against a 9000 deposit is 22500 wanted — which is
        // then capped at the 9000 there is. Reading the percentage off the
        // COLLECTED figure instead would give 4500, and every case where price
        // equals paid agrees with both readings, so this is the only case that
        // can tell them apart.
        expect(at(h(12), { priceCents: 45000, paidCents: 9000 }))
            .toMatchObject({ feeCents: 9000, refundCents: 0, cappedAtCollected: true });
    });

    it('never charges a fee larger than what was collected', () => {
        expect(at(h(-24), { event: 'no_show', paidCents: 9000 }))
            .toMatchObject({ feeCents: 9000, refundCents: 0, cappedAtCollected: true });
    });

    it('does not flag a cap when the ladder fits inside what was collected', () => {
        expect(at(h(12))).toMatchObject({ cappedAtCollected: false });
    });

    it('charges nothing against an unpaid order, and invents no receivable', () => {
        expect(at(h(-24), { event: 'no_show', paidCents: 0 }))
            .toMatchObject({ feeCents: 0, refundCents: 0 });
    });

    it('charges nothing when no policy is configured', () => {
        expect(at(h(1), { policy: null }))
            .toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'no_policy' });
    });

    it('charges nothing when the order has no precise scheduled instant', () => {
        // `scheduled_start_ms` is NULL on legacy and manually-created orders.
        // Notice cannot be measured, and the wrong direction to guess is the
        // one that charges someone.
        expect(at(null)).toMatchObject({ feeCents: 0, refundCents: 45000, reason: 'no_scheduled_instant' });
    });

    it('still charges a no-show without a scheduled instant', () => {
        // The no-show did not need the clock; only the notice test does.
        expect(at(null, { event: 'no_show' })).toMatchObject({ feeCents: 45000, reason: 'no_show' });
    });

    it('applies a fixed fee in cents, not as a share', () => {
        expect(at(h(12), { policy: { ...POLICY, lateFee: { type: 'fixed', amountCents: 30000 } } }))
            .toMatchObject({ feeCents: 30000, refundCents: 15000 });
    });

    it('rounds a percentage to whole cents', () => {
        expect(at(h(12), { priceCents: 33333, paidCents: 33333 }))
            .toMatchObject({ feeCents: 16667, refundCents: 16666 });
    });

    it('a zero-fee ladder refunds in full inside the window', () => {
        const free: CancellationPolicy = {
            ...POLICY, lateFee: { type: 'percent', percent: 0 }, noShowFee: { type: 'fixed', amountCents: 0 },
        };
        expect(at(h(1), { policy: free })).toMatchObject({ feeCents: 0, refundCents: 45000 });
    });

    it('measures notice in real hours across a DST boundary', () => {
        // 2026-11-01 America/New_York gains an hour. The threshold is hours
        // between two INSTANTS, so the answer must not move: 25 elapsed hours
        // clears a 24-hour threshold whatever the wall clocks did in between.
        const before = Date.UTC(2026, 10, 1, 0, 30);
        expect(resolveCancellation({
            policy: POLICY, scheduledAt: before + 25 * 3_600_000, now: before,
            priceCents: 45000, paidCents: 45000, initiator: 'client', event: 'cancellation',
        })).toMatchObject({ feeCents: 0, reason: 'sufficient_notice' });
    });

    it('accepts Date instants as readily as epoch milliseconds', () => {
        expect(at(h(12))).toEqual(resolveCancellation({
            policy: POLICY, scheduledAt: new Date(h(12)), now: new Date(NOW),
            priceCents: 45000, paidCents: 45000, initiator: 'client', event: 'cancellation',
        }));
    });
});
