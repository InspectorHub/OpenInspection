/**
 * P-4 effective-price authority chain (Wave 0 policy, binding).
 *
 * Authority order (highest → lowest):
 *   1. invoice.amountCents      — when an invoice exists it is authoritative.
 *   2. SUM(inspectionServices)  — priceOverride ?? priceSnapshot per line.
 *                                 An EMPTY array is treated as "no services attached"
 *                                 and falls through to the next tier (see note below).
 *   3. inspections.price        — denormalized cache. Read-only from this helper's
 *                                 perspective; never write back from tiers 1 or 2.
 *   4. 0                        — when all tiers are absent or null.
 *
 * Empty-array decision: `serviceLines: []` means the inspection has no services
 * attached yet, which is logically distinct from "services exist but all are free".
 * Falling through to the cache tier prevents a freshly created inspection (with no
 * services) from accidentally zeroing out a manually entered inspection price.
 * If, in the future, you need to express "explicitly zero-priced service bundle",
 * add at least one service line with priceSnapshot=0.
 */

export interface EffectivePriceInput {
    /** invoice.amountCents — authoritative when present (including 0). */
    invoiceAmountCents?: number | null;
    /**
     * inspection_services rows for the inspection.
     * null / undefined = not loaded (fall through).
     * []              = no services attached (fall through, not zero — see module note).
     * non-empty       = sum of (priceOverride ?? priceSnapshot) per line.
     */
    serviceLines?: Array<{ priceSnapshot: number; priceOverride?: number | null }> | null;
    /** inspections.price — denormalized cache, lowest authoritative tier. */
    inspectionPriceCents?: number | null;
}

/**
 * P-4 authority chain: invoice > service snapshots (override ?? snapshot) > cached
 * inspections.price > 0.
 *
 * Pure function — no side effects, no DB access. Safe to call from both server
 * loaders and client components.
 */
export function getEffectivePriceCents(input: EffectivePriceInput): number {
    const { invoiceAmountCents, serviceLines, inspectionPriceCents } = input;

    // Tier 1: invoice is authoritative when present (including zero-value invoices).
    if (invoiceAmountCents != null) {
        return invoiceAmountCents;
    }

    // Tier 2: sum service lines when the array is non-empty.
    // Empty array falls through (see module-level note).
    if (Array.isArray(serviceLines) && serviceLines.length > 0) {
        return serviceLines.reduce((sum, line) => {
            const lineCents = line.priceOverride ?? line.priceSnapshot;
            return sum + lineCents;
        }, 0);
    }

    // Tier 3: denormalized cache on inspections.price.
    if (inspectionPriceCents != null) {
        return inspectionPriceCents;
    }

    // Tier 4: no data — default to zero.
    return 0;
}
