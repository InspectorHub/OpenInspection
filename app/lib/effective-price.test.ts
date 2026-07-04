import { describe, it, expect } from 'vitest';
import { getEffectivePriceCents } from '~/lib/effective-price';

/**
 * P-4 authority chain:
 *   invoice > service snapshots (priceOverride ?? priceSnapshot) > cached inspections.price > 0
 *
 * Empty-array decision: an empty serviceLines array means "no services attached",
 * which is logically different from "services exist with zero price". An empty array
 * falls through to the inspectionPriceCents cache tier rather than returning zero.
 * This prevents a newly created inspection with no services from wiping out a
 * manually set price on the inspection row.
 */
describe('getEffectivePriceCents — P-4 authority chain', () => {
    // --- Tier 1: invoice wins over everything ---

    it('invoice amount wins when all tiers are present', () => {
        expect(getEffectivePriceCents({
            invoiceAmountCents: 50000,
            serviceLines: [
                { priceSnapshot: 30000 },
                { priceSnapshot: 10000, priceOverride: 20000 },
            ],
            inspectionPriceCents: 99000,
        })).toBe(50000);
    });

    it('invoice amount of 0 still wins (zero invoice is intentional)', () => {
        expect(getEffectivePriceCents({
            invoiceAmountCents: 0,
            serviceLines: [{ priceSnapshot: 30000 }],
            inspectionPriceCents: 30000,
        })).toBe(0);
    });

    // --- Tier 2: service snapshot sum (with override precedence) ---

    it('sums service lines using priceOverride ?? priceSnapshot per line', () => {
        // Line 1: override 20000, snapshot 30000 — override wins
        // Line 2: no override, snapshot 15000 — snapshot used
        // Total: 35000
        expect(getEffectivePriceCents({
            serviceLines: [
                { priceSnapshot: 30000, priceOverride: 20000 },
                { priceSnapshot: 15000 },
            ],
            inspectionPriceCents: 99000,
        })).toBe(35000);
    });

    it('override of 0 on a service line is honored (zero-price override is intentional)', () => {
        expect(getEffectivePriceCents({
            serviceLines: [
                { priceSnapshot: 30000, priceOverride: 0 },
                { priceSnapshot: 10000 },
            ],
        })).toBe(10000);
    });

    // --- Empty-array fall-through ---

    it('empty serviceLines array falls through to inspectionPriceCents cache tier', () => {
        // An empty array = no services attached = not authoritative.
        // Must not return zero; must fall to the next tier.
        expect(getEffectivePriceCents({
            serviceLines: [],
            inspectionPriceCents: 45000,
        })).toBe(45000);
    });

    // --- Tier 3: inspections.price cache ---

    it('falls through to inspectionPriceCents when serviceLines is null/undefined', () => {
        expect(getEffectivePriceCents({
            inspectionPriceCents: 45000,
        })).toBe(45000);
    });

    it('falls through to inspectionPriceCents when serviceLines is null', () => {
        expect(getEffectivePriceCents({
            serviceLines: null,
            inspectionPriceCents: 45000,
        })).toBe(45000);
    });

    // --- Tier 4: zero when all absent ---

    it('returns 0 when no tier has data', () => {
        expect(getEffectivePriceCents({})).toBe(0);
    });

    it('returns 0 when all tiers are null', () => {
        expect(getEffectivePriceCents({
            invoiceAmountCents: null,
            serviceLines: null,
            inspectionPriceCents: null,
        })).toBe(0);
    });
});
