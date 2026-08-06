/**
 * What the processor keeps when money goes back.
 *
 * Stripe does not return its processing fee on a refund — including a partial
 * one. Refunding $50 of a $100 charge still costs the merchant the fee on the
 * full $100. So a tenant who promises "full refund on 24 hours notice" is out
 * of pocket by roughly 2.9% + $0.30 of the ORIGINAL charge every time they
 * honour it, and they find that out per-cancellation unless someone tells them
 * up front.
 *
 * This is an ESTIMATE and must be presented as one. Stripe's rate is per
 * account, per card type and per country — an international card or an
 * Amex-heavy book will not match. The number exists to make the loss visible
 * before a policy is written, not to reconcile against a statement.
 */

/** Stripe's standard US card rate at the time of writing. An estimate. */
const PERCENT_BPS = 290;
const FIXED_CENTS = 30;

/**
 * The non-recoverable processing fee on a charge of `chargedCents`.
 *
 * Takes the ORIGINAL charge, not the refunded amount: the fee was levied on
 * what came in, and refunding part of it recovers none of the fee.
 */
export function estimateRetainedProcessingFeeCents(chargedCents: number): number {
    if (chargedCents <= 0) return 0;
    return Math.round((chargedCents * PERCENT_BPS) / 10_000) + FIXED_CENTS;
}
