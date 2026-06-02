/**
 * Payment-method vocabulary for invoices.
 *
 * `card`    — paid online via Stripe (set by the webhook).
 * `check`   — paid by paper check (offline).
 * `cash`    — paid in cash (offline).
 * `offline` — any other offline rail (bank transfer / ACH / wire).
 * `other`   — unknown / unspecified.
 *
 * Inspectors record the offline methods manually via "Mark as paid"; the
 * online path always stamps `card`.
 */
export const PAYMENT_METHODS = ['card', 'check', 'cash', 'offline', 'other'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

const CANONICAL = new Set<string>(PAYMENT_METHODS);

/** Coerces arbitrary user/UI input into a canonical PaymentMethod. */
export function normalizePaymentMethod(input: unknown): PaymentMethod {
    if (typeof input !== 'string') return 'other';
    const v = input.trim().toLowerCase();
    if (CANONICAL.has(v)) return v as PaymentMethod;
    if (v === 'cheque') return 'check';
    if (v === 'ach' || v === 'wire' || v.includes('bank') || v.includes('transfer')) return 'offline';
    return 'other';
}
