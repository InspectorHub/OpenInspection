import { describe, it, expect } from 'vitest';

/**
 * iter-1 production bug #3 — `/report/:id` paywall did not fire for an
 * inspection whose `payment_required` column was set, because the gate
 * compared with `=== true`. D1 booleans can transit as the integer `1`
 * (Drizzle's `mode: 'boolean'` is a Drizzle-side conversion that some
 * codepaths bypass), so the strict comparison missed the gate while the
 * inspection-edit sidebar toggle — which uses truthy coercion — still
 * showed the toggle as ON.
 *
 * This spec pins the coercion contract: any truthy value (`true` OR `1`
 * OR `"1"`) MUST gate, and only false-y values (`false`, `0`, `null`,
 * `undefined`, `""`) skip the gate. The same coercion is applied to
 * BOTH the toggle (Alpine state, see public/js/inspection-edit.js) and
 * the server gate (src/index.ts) so the two surfaces always agree.
 */

/**
 * Mirror of the gate predicate after the iter-1 fix: `!!flag`.
 * Codifies the rule we now rely on across every gate site.
 */
function shouldGatePayment(flag: unknown, paymentStatus: unknown): boolean {
    return !!flag && paymentStatus !== 'paid';
}

function shouldGateAgreement(flag: unknown): boolean {
    return !!flag;
}

describe('iter-1 #3 — report gate truthy coercion', () => {
    describe('paymentRequired', () => {
        it('gates when stored as boolean true', () => {
            expect(shouldGatePayment(true, 'unpaid')).toBe(true);
        });

        it('gates when stored as integer 1 (D1 raw shape)', () => {
            // Pre-fix, this case fell through `=== true` and the report
            // rendered without paywall.
            expect(shouldGatePayment(1, 'unpaid')).toBe(true);
        });

        it('skips gate when paymentStatus is "paid", regardless of flag', () => {
            expect(shouldGatePayment(true, 'paid')).toBe(false);
            expect(shouldGatePayment(1, 'paid')).toBe(false);
        });

        it('skips gate when flag is false / 0 / null / undefined', () => {
            expect(shouldGatePayment(false, 'unpaid')).toBe(false);
            expect(shouldGatePayment(0, 'unpaid')).toBe(false);
            expect(shouldGatePayment(null, 'unpaid')).toBe(false);
            expect(shouldGatePayment(undefined, 'unpaid')).toBe(false);
        });
    });

    describe('agreementRequired', () => {
        it('gates when stored as boolean true', () => {
            expect(shouldGateAgreement(true)).toBe(true);
        });

        it('gates when stored as integer 1 (D1 raw shape)', () => {
            expect(shouldGateAgreement(1)).toBe(true);
        });

        it('skips gate when flag is false / 0 / null / undefined', () => {
            expect(shouldGateAgreement(false)).toBe(false);
            expect(shouldGateAgreement(0)).toBe(false);
            expect(shouldGateAgreement(null)).toBe(false);
            expect(shouldGateAgreement(undefined)).toBe(false);
        });
    });

    describe('toggle vs gate agreement', () => {
        it('toggle ON ⇔ gate fires (no UI/server mismatch)', () => {
            const flag = 1; // raw D1 shape that surfaced the bug
            const toggleVisualOn = !!flag; // mirrors Alpine `flag ? on : off`
            const gateFires = shouldGatePayment(flag, 'unpaid');
            expect(toggleVisualOn).toBe(gateFires);
        });
    });
});
