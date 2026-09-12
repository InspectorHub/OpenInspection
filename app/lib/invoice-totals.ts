/**
 * Roll-ups for the invoices list's stat cards.
 *
 * ── WHY THE CASH CARD IS NOT CALLED REVENUE (F28) ───────────────────────────
 *
 * Two pages labelled a figure "REVENUE" and the two numbers contradicted each
 * other, with nothing on either page saying so: /metrics read $900 (two $450
 * jobs BILLED) while /invoices read $0.00 at the same moment (nothing yet
 * RECEIVED). Revenue is the billed figure — an invoice earns revenue when it is
 * raised, not when it clears — so /metrics keeps the word and the invoices card
 * is labelled for the cash it holds.
 *
 * And it now holds the cash. The old figure was the full amount of every invoice
 * whose status was `paid`, which is neither of the two: $200 banked against a
 * $450 invoice leaves that invoice `partial`, so a card about money received
 * read $0 on a day money arrived.
 */

/** The fields of an invoice row this module reads. Nothing else. */
export interface InvoiceMoneyRow {
    amountCents: number;
    /** Net received, maintained by the payment ledger's single writer. */
    amountPaidCents: number | null;
    status: "draft" | "sent" | "paid" | "partial" | "void";
}

/**
 * Total money actually received across these invoices, in integer cents.
 *
 * Two adjustments, both for honesty rather than tidiness:
 *
 *  - a VOID invoice contributes nothing. The row survives for the audit trail
 *    (DELETE /api/invoices/{id} voids rather than deletes), and the void copy
 *    already promises it stops counting.
 *  - a `paid` invoice contributes AT LEAST its total. An invoice marked paid
 *    before the payment ledger existed has no ledger rows for
 *    `recomputeInvoicePaymentState` to derive from — it returns early and leaves
 *    the column alone — so reading `amountPaidCents` there would erase a real
 *    payment. `paid` means the total came in; an overpayment still reports the
 *    larger figure, because that is the money that arrived.
 */
export function collectedCents(invoices: readonly InvoiceMoneyRow[]): number {
    return invoices
        .filter((invoice) => invoice.status !== "void")
        .reduce((sum, invoice) => {
            const received = invoice.amountPaidCents ?? 0;
            const total = invoice.amountCents || 0;
            return sum + (invoice.status === "paid" ? Math.max(received, total) : received);
        }, 0);
}
