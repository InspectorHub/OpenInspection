/**
 * The idempotency key for a QuickBooks Payment push.
 *
 * QBO's `requestid` returns the ORIGINAL response for a repeated key rather
 * than performing the operation again, and keys are unique per company
 * FOREVER. So the key has to identify the fact — the thing that happened once —
 * and never the attempt. Both push sites (the manual "mark as paid" route and
 * the Stripe webhook) derive it from here so they agree: one invoice settled
 * online and then also marked paid by hand is one payment, not two.
 *
 * Today the fact is the invoice, because payment is all-or-nothing. When a
 * payment ledger exists the fact becomes the ledger ROW — a $90 deposit and a
 * $360 balance are two payments against one invoice — and this function changes
 * to take the row id. Every caller must move in that same change: an invoice
 * pushed under the old key and re-pushed under a new one is a duplicate in
 * someone's books, and they would find it at tax time rather than in a test.
 */
export function qboPaymentKey(invoiceId: string): string {
    return `pay-${invoiceId}`;
}
