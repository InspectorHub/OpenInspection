/**
 * A payment discrepancy: QuickBooks and our payment ledger disagree about what
 * was collected against an invoice.
 *
 * Spec 2026-08-01 payment/deposit flow §6 — our ledger is authoritative for what
 * WE collected; QuickBooks reports a balance and cannot reconstruct our rows.
 * When they disagree the rule is to flag it and let a human reconcile. Writing
 * an adjusting entry to make the numbers agree would record money movement
 * nobody performed, and it would be indistinguishable afterwards from money that
 * really moved.
 *
 * Discrepancies ride the existing `qbo_sync_errors` table under their own
 * `error_code`: it already has a tenant scope, a resolved flag, a settings
 * surface and a resolve action, and a discrepancy is exactly what that table is
 * for — something a human has to look at. What it does not have is a column per
 * figure, so both figures live in `error_msg` under the codec below. It is
 * written and read only here, which is what makes that safe.
 */
export const QBO_PAYMENT_DISCREPANCY = 'PAYMENT_DISCREPANCY';

/**
 * QuickBooks zeroed the document — a void, in practice.
 *
 * Its own code because it is NOT a disagreement about money: nothing was
 * collected and nothing is claimed to have been. It rides the same table for
 * the same reason as above, and it exists because the two numbers a voided
 * invoice reports (`TotalAmt` 0, `Balance` 0) are byte-identical to the ones a
 * fully-settled invoice reports. Reading them as settlement marked a voided
 * $555 invoice paid in full, against a ledger holding no payment at all
 * (observed in the sandbox, 2026-08-16).
 */
export const QBO_VOIDED_IN_QBO = 'VOIDED_IN_QBO';

export interface PaymentDiscrepancy {
    /** What our ledger says we received, in integer cents. */
    ledgerCents: number;
    /** QuickBooks' implied paid amount (TotalAmt − Balance), in integer cents. */
    qboCents: number;
}

export function encodePaymentDiscrepancy(d: PaymentDiscrepancy): string {
    return JSON.stringify({ ledgerCents: d.ledgerCents, qboCents: d.qboCents });
}

/** `null` for anything this module did not write — never guess at both figures. */
export function decodePaymentDiscrepancy(errorMsg: string): PaymentDiscrepancy | null {
    try {
        const parsed: unknown = JSON.parse(errorMsg);
        if (typeof parsed !== 'object' || parsed === null) return null;
        const { ledgerCents, qboCents } = parsed as Record<string, unknown>;
        if (!Number.isInteger(ledgerCents) || !Number.isInteger(qboCents)) return null;
        return { ledgerCents: ledgerCents as number, qboCents: qboCents as number };
    } catch {
        return null;
    }
}
