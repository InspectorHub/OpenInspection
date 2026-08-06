/**
 * The moment a held deposit becomes an invoice payment.
 *
 * Under GAAP a customer deposit is a LIABILITY — unearned revenue — not
 * income, until the work is delivered. So the deposit is held against the
 * ORDER (`order_payments` with a null `invoice_id`), and only when an invoice
 * exists does it become money against that invoice. This is that transition,
 * and it is the ONE exception to the ledger's append-only rule: `invoice_id`
 * is written once onto rows that predate the invoice. Nothing else about the
 * row changes — not the amount, not the kind, not when the money moved.
 *
 * TWO THINGS THAT LOOK OPTIONAL AND ARE NOT:
 *
 *  - `recomputeInvoicePaymentState` is the only writer of the invoice's cached
 *    `amount_paid_cents` / `partial_paid_at` / `paid_at`, and backfilling rows
 *    under it without calling it leaves the cache disagreeing with the money.
 *  - `syncInspectionPaymentGate` runs even though this can only ever ADD money.
 *    That reads backwards until you notice what it actually guards: the gate is
 *    a cache of "some unvoided invoice on this order is paid", and this
 *    function moves an order from "no invoice" to "an invoice with a partial
 *    payment". The re-sync is what asserts, in code rather than in a comment,
 *    that a $90 deposit against a $450 invoice leaves the report LOCKED. A
 *    deposit is a scheduling instrument; paid-in-full is what releases a report.
 *
 * IDEMPOTENT BY CONSTRUCTION. It claims only rows whose `invoice_id` IS NULL,
 * so a second invoice on the same order finds nothing left to claim — the
 * deposit is applied once, to the first invoice raised, and a later invoice
 * starts from zero rather than double-crediting the client.
 */
import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { orderPayments } from '../../lib/db/schema/order-payment';
import { recomputeInvoicePaymentState } from '../payment-ledger.service';
import { syncInspectionPaymentGate } from '../invoice-payment-gate';

/**
 * Attach every payment held against this order to the invoice just raised.
 * Returns how many rows moved — zero is the overwhelmingly common answer, and
 * costs one indexed read.
 */
export async function applyHeldDepositsToInvoice(
    db: DrizzleD1Database,
    tenantId: string,
    invoiceId: string,
    inspectionId: string,
): Promise<number> {
    const held = await db.select({ id: orderPayments.id })
        .from(orderPayments)
        .where(and(
            eq(orderPayments.tenantId, tenantId),
            eq(orderPayments.inspectionId, inspectionId),
            isNull(orderPayments.invoiceId),
        ))
        .all();
    if (held.length === 0) return 0;

    await db.update(orderPayments)
        .set({ invoiceId })
        .where(and(
            eq(orderPayments.tenantId, tenantId),
            eq(orderPayments.inspectionId, inspectionId),
            isNull(orderPayments.invoiceId),
        ));

    await recomputeInvoicePaymentState(db, tenantId, invoiceId);
    await syncInspectionPaymentGate(db, tenantId, inspectionId);
    return held.length;
}
