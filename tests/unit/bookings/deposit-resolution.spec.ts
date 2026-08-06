/**
 * The three-tier deposit, resolved.
 *
 * These are the arithmetic cases a tenant will argue about, so they are here
 * without a database in the room. What they are actually guarding:
 *
 *  1. `none` is a VALUE. A service must be able to say "not this one" against a
 *     workspace default that says otherwise, and NULL cannot express that — it
 *     already means "inherit".
 *  2. A deposit never exceeds the price. A fixed $200 against a $150 add-on is
 *     $150; the alternative invents a receivable nobody agreed to.
 *  3. The workspace default applies ONCE to an order, not once per service. A
 *     flat "$100 deposit" turning into $300 on a three-service booking is the
 *     bug this shape exists to prevent — and the mirror-image bug, applying the
 *     default across the whole order and so re-charging the lines that opted
 *     out, is guarded in the same block.
 */
import { describe, it, expect } from 'vitest';
import { resolveDeposit, resolveOrderDeposit } from '../../../server/lib/billing/deposit-policy';

describe('resolveDeposit — one policy, one price', () => {
    it('resolves the service policy over the tenant default', () => {
        expect(resolveDeposit({
            tenant: { type: 'percent', percent: 20 },
            service: { type: 'fixed', amountCents: 7500 },
            priceCents: 45000,
        })).toBe(7500);
    });

    it('lets a service opt out of the tenant default', () => {
        expect(resolveDeposit({
            tenant: { type: 'percent', percent: 20 },
            service: { type: 'none' },
            priceCents: 45000,
        })).toBe(0);
    });

    it('inherits when the service has no policy', () => {
        expect(resolveDeposit({
            tenant: { type: 'percent', percent: 20 },
            service: null,
            priceCents: 45000,
        })).toBe(9000);
    });

    it('charges nothing when neither tier has a policy', () => {
        expect(resolveDeposit({ tenant: null, service: null, priceCents: 45000 })).toBe(0);
    });

    it('never exceeds the price', () => {
        // A fixed $200 deposit against a $150 add-on must not exceed it.
        expect(resolveDeposit({
            tenant: null,
            service: { type: 'fixed', amountCents: 20000 },
            priceCents: 15000,
        })).toBe(15000);
    });

    it('rounds percentages to whole cents', () => {
        expect(resolveDeposit({
            tenant: { type: 'percent', percent: 33 },
            service: null,
            priceCents: 10000,
        })).toBe(3300);
        // 12.5% of $99.99 is 1249.875 cents. Money moves in whole cents.
        expect(resolveDeposit({
            tenant: { type: 'percent', percent: 12.5 },
            service: null,
            priceCents: 9999,
        })).toBe(1250);
    });

    it('treats a negative or zero price as nothing owed', () => {
        expect(resolveDeposit({ tenant: { type: 'percent', percent: 20 }, service: null, priceCents: 0 })).toBe(0);
        expect(resolveDeposit({ tenant: { type: 'fixed', amountCents: 5000 }, service: null, priceCents: -1 })).toBe(0);
    });
});

describe('resolveOrderDeposit — one deposit for the whole order', () => {
    const tenant20 = { type: 'percent' as const, percent: 20 };
    const tenantFlat = { type: 'fixed' as const, amountCents: 10000 };

    it('applies a flat workspace default ONCE across a multi-service booking', () => {
        // Three services, one deposit. Charging the flat amount per line would
        // make this $300 — the client agreed to one deposit for one visit.
        expect(resolveOrderDeposit({
            tenant: tenantFlat,
            lines: [
                { priceCents: 45000, policy: null },
                { priceCents: 15000, policy: null },
                { priceCents: 9500,  policy: null },
            ],
        })).toBe(10000);
    });

    it('does not re-charge a line that opted out, even under a workspace default', () => {
        // The radon add-on says `none`. 20% of the $450 inspection is $90 and
        // that is the whole deposit; applying the default to the order total
        // would quietly bill $109 and make tier 2 decorative.
        expect(resolveOrderDeposit({
            tenant: tenant20,
            lines: [
                { priceCents: 45000, policy: null },
                { priceCents: 9500,  policy: { type: 'none' } },
            ],
        })).toBe(9000);
    });

    it('adds a service that prices its own deposit to the default on the rest', () => {
        // Sewer scope carries a flat $75; the workspace default covers what is
        // left ($450 → $90).
        expect(resolveOrderDeposit({
            tenant: tenant20,
            lines: [
                { priceCents: 45000, policy: null },
                { priceCents: 25000, policy: { type: 'fixed', amountCents: 7500 } },
            ],
        })).toBe(16500);
    });

    it('matches the single-line answer when only one service is selected', () => {
        expect(resolveOrderDeposit({ tenant: tenant20, lines: [{ priceCents: 45000, policy: null }] }))
            .toBe(resolveDeposit({ tenant: tenant20, service: null, priceCents: 45000 }));
    });

    it('caps the order deposit at the order total', () => {
        expect(resolveOrderDeposit({
            tenant: null,
            lines: [
                { priceCents: 5000, policy: { type: 'fixed', amountCents: 4000 } },
                { priceCents: 3000, policy: { type: 'fixed', amountCents: 9000 } },
            ],
        })).toBe(7000);
    });

    it('charges nothing for an empty order or an unconfigured workspace', () => {
        expect(resolveOrderDeposit({ tenant: tenant20, lines: [] })).toBe(0);
        expect(resolveOrderDeposit({ tenant: null, lines: [{ priceCents: 45000, policy: null }] })).toBe(0);
    });
});
