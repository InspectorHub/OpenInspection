/**
 * The idempotency key for a QuickBooks Payment push.
 *
 * QBO's `requestid` returns the ORIGINAL response for a repeated key rather
 * than performing the operation again, and keys are unique per company
 * FOREVER. So the key has to identify the fact — the thing that happened once —
 * and never the attempt.
 *
 * The fact is the ledger ROW, not the invoice. A $90 deposit and a $360 balance
 * are two payments against one invoice: keyed by the invoice they would collapse
 * into one in the tenant's books, losing $90 of real revenue, and the second
 * would carry the wrong amount besides. Both push sites (the manual "mark as
 * paid" route and the Stripe webhook) derive the key from here so they agree —
 * and both take it from the row `recordPayment` RETURNED, never from their own
 * arguments, so an append that did not happen cannot push.
 *
 * A row id is a UUID, so the key is 40 characters — well inside QBO's limit, and
 * deliberately not a concatenation of everything available.
 *
 * ⚠️ Moving off the older `pay-${invoiceId}` derivation is safe only because an
 * invoice could be pushed at most once under it: `markPaid` returns without
 * appending when `paid_at` is already set, so an invoice settled under the old
 * key never produces a row to re-push under a new one. Any future change to this
 * derivation has to re-establish that, or it duplicates payments in someone's
 * books and they find it at tax time rather than in a test.
 */
export function qboPaymentKey(paymentRowId: string): string {
    return `pay-${paymentRowId}`;
}

/**
 * The same rule for money going the other way: a CreditMemo push is keyed on
 * the `refund`-kind ledger row, never on the invoice.
 *
 * This is not a second convention — it is `qboPaymentKey` with a different
 * prefix, deliberately in the same file so the two cannot drift. The prefix
 * exists because `requestid` is unique per COMPANY and these keys end up side
 * by side in one namespace: distinct prefixes make a memo legible as a memo
 * when someone is reading Intuit's request log to explain a figure.
 *
 * Keying on the invoice would be worse here than for a payment. `qbo_entity_map`
 * is uniquely indexed on (tenant, oi_type, oi_id), so a memo stored under
 * `oiId: invoiceId` allows exactly ONE credit memo per invoice forever: a second
 * refund on the same invoice — a cancellation fee refunded, then the retained
 * part released — creates the memo in QuickBooks and then throws on the map
 * insert, leaving the memo live with nothing recording it.
 */
export function qboRefundKey(refundRowId: string): string {
    return `refund-${refundRowId}`;
}
