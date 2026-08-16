import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { qboEntityMap } from '../../lib/db/schema/qbo';
import { getLedgerOpinion } from '../payment-ledger.service';
import type { InvoiceSummary, MarkPaidFn, MarkPartialFn } from './api-base';

/**
 * Discrepancy bookkeeping, passed in rather than inherited.
 *
 * This module travels in the opposite direction to the rest of `invoice-sync`:
 * everything there pushes OUR state at QuickBooks, and this reads THEIRS and
 * decides how much of it we are allowed to believe. Keeping it apart is what
 * makes the answer to that question readable on its own.
 */
export interface ReconcileDeps {
    clearPaymentDiscrepancy(tenantId: string, invoiceId: string): Promise<void>;
    recordPaymentDiscrepancy(
        tenantId: string, invoiceId: string, ledgerCents: number, qboCents: number,
    ): Promise<void>;
    noteVoidedInQuickBooks(tenantId: string, invoiceId: string): Promise<void>;
}

/**
 * Apply what QuickBooks says about one invoice — as far as our ledger permits.
 *
 * Returns false for an invoice we have no mapping for, which is not a failure:
 * the sweep sees every invoice in the company, including ones this product
 * never created.
 */
export async function applyInvoiceStatusFromQBO(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: DrizzleD1Database<any>,
    tenantId: string,
    inv: InvoiceSummary,
    markPaid: MarkPaidFn,
    markPartial: MarkPartialFn,
    deps: ReconcileDeps,
): Promise<boolean> {
            const mapped = await db.select().from(qboEntityMap).where(
                and(
                    eq(qboEntityMap.tenantId, tenantId),
                    eq(qboEntityMap.qboType, 'Invoice'),
                    eq(qboEntityMap.qboId, inv.Id),
                ),
            ).get();
            if (!mapped) return false;

            await db.update(qboEntityMap).set({
                qboSyncToken: inv.SyncToken,
                syncedAt:     new Date(),
            }).where(eq(qboEntityMap.id, mapped.id));

            // A VOID first, because after one the numbers below stop meaning
            // what they say. QuickBooks zeroes a voided invoice: `TotalAmt` 0
            // and `Balance` 0 — the identical pair a fully-settled invoice
            // reports. Falling through to the balance logic read a voided $555
            // invoice as paid in full and stamped `paid_at` on a ledger holding
            // no payment at all, which unlocks the report and counts $555 of
            // revenue nobody sent (sandbox, 2026-08-16).
            //
            // Zero total, not zero balance: an invoice worth nothing has no
            // settlement to report either way, so this costs no real case.
            if (inv.TotalAmt === 0) {
                await deps.noteVoidedInQuickBooks(tenantId, mapped.oiId);
                return true;
            }

            // QuickBooks amounts are dollars (see the reverse mapping in
            // upsertInvoice, `Amount: amountCents / 100`). Round each side to
            // its own exact cent value before subtracting: a bare float
            // multiply on the difference produces off-by-one-cent amounts
            // that are impossible to explain to a customer. This is the ONLY
            // place the conversion happens — adapters receive cents.
            const qboPaidCents = Math.round(inv.TotalAmt * 100) - Math.round(inv.Balance * 100);

            // Spec §6. Our ledger is authoritative for what WE collected;
            // QuickBooks reports a balance and cannot reconstruct our rows. So
            // once the ledger has an opinion, this sweep may only COMPARE:
            // applying QuickBooks' figure here would append an adjusting row,
            // and an adjusting row is money movement nobody performed that is
            // indistinguishable afterwards from money that really moved.
            const opinion = await getLedgerOpinion(db, tenantId, mapped.oiId);
            if (opinion.rowCount > 0) {
                if (opinion.netCents === qboPaidCents) {
                    await deps.clearPaymentDiscrepancy(tenantId, mapped.oiId);
                } else {
                    await deps.recordPaymentDiscrepancy(tenantId, mapped.oiId, opinion.netCents, qboPaidCents);
                }
                return true;
            }

            // No rows means the ledger has NO OPINION — not that nothing was
            // paid. (Same rule `recomputeInvoicePaymentState` applies to the
            // cache.) There is nothing for QuickBooks to contradict, so it is
            // the only account of this invoice there is and applying it is the
            // first record rather than an adjustment.
            if (inv.Balance === 0) {
                await markPaid(mapped.oiId, tenantId);
            } else if (inv.Balance < inv.TotalAmt) {
                await markPartial(mapped.oiId, qboPaidCents, tenantId);
            }
            return true;
}
