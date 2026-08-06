/**
 * Money going back out.
 *
 * Both refund writers live here, together, on purpose. They were about to be
 * split across two files — `markRefunded` where the ledger already was, and
 * the partial next to its caller — and two writers of the same concept in two
 * places is the shape where one of them gets the next fix and the other
 * quietly does not. There is exactly one place to look for "how does this
 * product refund".
 *
 * The house rules both obey:
 *
 *  - **Append, never rewrite.** A refund is a `refund`-kind ROW. The invoice's
 *    derived columns are recomputed from the ledger by its single writer.
 *  - **Re-sync the report gate.** `inspections.payment_status = 'paid'` is a
 *    CACHE of "some unvoided invoice on this inspection is paid", and a refund
 *    can falsify it. Skipping the re-sync leaves a report publicly readable
 *    with no backing payment, and no test that ignores `inspections` notices.
 *  - **Return the row.** `refundPartial` answers with the appended row rather
 *    than void, because an external book of record has to key its credit memo
 *    on the ROW id: `qbo_entity_map` is uniquely indexed on
 *    (tenant, type, oiId) and can hold exactly one credit memo per invoice
 *    forever, so keying on the invoice makes a second refund throw INSIDE the
 *    push — the memo lands in QuickBooks and the map row is lost. Per-row
 *    identity is the only shape that survives a second refund.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { invoices } from '../../lib/db/schema/invoice';
import { Errors } from '../../lib/errors';
import {
    recordPayment,
    recomputeInvoicePaymentState,
    getNetReceivedCents,
    getHeldDepositCents,
    seedLedgerFromInvoiceRecord,
} from '../payment-ledger.service';
import type { AppendedPayment } from '../payment-ledger.service';
import { syncInspectionPaymentGate } from '../invoice-payment-gate';

/** Body of a partial refund. */
export interface PartialRefundInput {
    /** Positive integer cents. Direction is carried by the row's `kind`. */
    amountCents: number;
    /** Why the money went back. Stored on the row and read by humans later. */
    reason: string;
    recordedBy?: string | null;
    /** When the money MOVED. Defaults to now. */
    occurredAt?: Date;
}

/**
 * Send SOME of the money back.
 *
 * The gap `markRefunded` cannot fill: it reverses everything received, and
 * `correctPayment` is explicitly not a refund (it rewrites a mistyped figure
 * and refuses a second correction on the same row). Neither can return 22500
 * of 45000 and leave the rest retained as a cancellation fee.
 *
 * Refuses to refund more than has been received. That is the one guard that
 * matters: without it a refund invents money leaving an account that never
 * held it, and the invoice's cached total goes negative in a column whose
 * whole contract is that it never is.
 */
export async function refundPartial(
    db: DrizzleD1Database,
    tenantId: string,
    id: string,
    input: PartialRefundInput,
): Promise<AppendedPayment> {
    const existing = await db.select().from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Invoice not found');

    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw Errors.UnprocessableEntity('A refund must be a positive whole number of cents.');
    }

    // An invoice paid before the ledger existed has no rows to reverse, so the
    // received figure would read as zero and every refund would be refused.
    await seedLedgerFromInvoiceRecord(db, tenantId, id);
    const received = await getNetReceivedCents(db, tenantId, id);
    if (input.amountCents > received) {
        // No figure in the message: it would have to be raw minor units, and
        // the surface asking already shows the received total formatted in the
        // invoice's own currency.
        throw Errors.UnprocessableEntity(
            'This refund is larger than what has been received on this invoice.',
        );
    }

    const appended = await recordPayment(db, tenantId, {
        invoiceId: id,
        inspectionId: existing.inspectionId,
        kind: 'refund',
        amountCents: input.amountCents,
        method: existing.paymentMethod ?? 'other',
        // No provider and no provider_ref: this row records that the money is
        // owed back, not that a processor has moved it. Whoever moves it keys
        // their push off the row returned here.
        provider: null,
        providerRef: null,
        recordedBy: input.recordedBy ?? null,
        note: input.reason,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    // `recordPayment` answers null only for a provider redelivery, and this row
    // carries no provider. Narrow rather than assert, so a future change to
    // that contract surfaces here instead of as a null body on a 200.
    if (!appended) throw Errors.Conflict('This refund was already recorded.');

    await syncInspectionPaymentGate(db, tenantId, existing.inspectionId);
    return appended;
}

/**
 * Send back money held against an ORDER that has no invoice — a booking
 * deposit, cancelled before anyone was billed.
 *
 * A THIRD writer, and the reason it is not a flag on `refundPartial`: that
 * function's body is "load the invoice, seed its ledger from its own record,
 * check what IT received, append against it, recompute ITS cache". Four of
 * those five steps have no meaning without an invoice. Passing `invoiceId:
 * null` through it would put two different functions behind one name, and the
 * one that skipped the guards would be the one handling money nobody has
 * billed for yet.
 *
 * WHAT IS ABSENT HERE, deliberately:
 *
 *  - No `recomputeInvoicePaymentState`. There is no invoice cache to refresh;
 *    the held total is derived from the rows every time it is read.
 *  - No `seedLedgerFromInvoiceRecord`. A held deposit exists only as ledger
 *    rows — there is no older column-shaped record it could be reconstructed
 *    from, so there is nothing to seed.
 *
 * The gate re-sync IS kept, even though a held deposit never set the gate:
 * `payment_status = 'paid'` flips only on a paid invoice, so this cannot
 * falsify it. Keeping the call means the house rule at the top of this file
 * holds for every writer without exception, which is cheaper to trust than an
 * exception someone has to re-derive.
 */
export async function refundHeldDeposit(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    input: PartialRefundInput,
): Promise<AppendedPayment> {
    if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw Errors.UnprocessableEntity('A refund must be a positive whole number of cents.');
    }

    const held = await getHeldDepositCents(db, tenantId, inspectionId);
    if (input.amountCents > held) {
        throw Errors.UnprocessableEntity(
            'This refund is larger than the deposit still held on this booking.',
        );
    }

    const appended = await recordPayment(db, tenantId, {
        inspectionId,
        // NULL, and it must stay null. Attaching this row to an invoice is what
        // `applyHeldDepositsToInvoice` does when one is raised; doing it here
        // would make a refund look like an invoice payment.
        invoiceId: null,
        kind: 'refund',
        amountCents: input.amountCents,
        method: 'card',
        provider: null,
        providerRef: null,
        recordedBy: input.recordedBy ?? null,
        note: input.reason,
        ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    });
    if (!appended) throw Errors.Conflict('This refund was already recorded.');

    await syncInspectionPaymentGate(db, tenantId, inspectionId);
    return appended;
}

/**
 * Refund an invoice in full: appends a `refund` row reversing everything
 * received, rather than nulling the columns. A fully refunded invoice therefore
 * reads as "45000 received, 45000 refunded, 0 outstanding received" instead of
 * a blank slate — more truthful, and the only version a reconciliation can
 * check. An invoice paid before the ledger existed is seeded from its own
 * record first, so there is something to reverse.
 *
 * Signature unchanged from when this lived in `invoice-payments.service`
 * (`(db, id, tenantId)`, tenant SECOND) — both are strings and reordering them
 * during a move is how the two get swapped in silence.
 */
export async function markRefunded(
    db: DrizzleD1Database,
    id: string,
    tenantId: string,
): Promise<void> {
    const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Invoice not found');

    await seedLedgerFromInvoiceRecord(db, tenantId, id);
    const received = await getNetReceivedCents(db, tenantId, id);
    if (received > 0) {
        await recordPayment(db, tenantId, {
            invoiceId: id,
            inspectionId: existing.inspectionId,
            kind: 'refund',
            amountCents: received,
            method: existing.paymentMethod ?? 'other',
        });
    } else {
        await recomputeInvoicePaymentState(db, tenantId, id);
    }
    await syncInspectionPaymentGate(db, tenantId, existing.inspectionId);
}
