/**
 * The payment-ledger face of an invoice.
 *
 * The boundary against `invoice.service.ts` is checkable rather than a matter
 * of taste: `InvoiceService` owns the invoice ROW — create, read, mark sent,
 * void, delete, earnings — and this module owns the LEDGER, meaning every path
 * that reads or appends `order_payments`, whether directly or through
 * `payment-ledger.service`. The check is mechanical: `payment-ledger.service`
 * has exactly one value importer among the two, and it is this file. A new
 * money writer that finds itself importing it in the other one is in the
 * wrong place.
 *
 * These are free functions taking the drizzle handle, the same shape as
 * `payment-ledger.service.ts` which they all orchestrate; `InvoiceService`
 * keeps a one-line method for each so no caller has to change. Parameter
 * ORDER is preserved exactly as each method declared it — `(id, tenantId)` for
 * some and `(tenantId, id)` for others — because both are `string` and
 * "tidying" that up during a move is how the two get swapped in silence.
 */
import { and, asc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { invoices } from '../lib/db/schema/invoice';
import { orderPayments } from '../lib/db/schema/order-payment';
import { users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import type { PaymentMethod } from '../lib/payment-method';
import {
    recordPayment,
    recomputeInvoicePaymentState,
    getNetReceivedCents,
    seedLedgerFromInvoiceRecord,
} from './payment-ledger.service';
import type { AppendedPayment } from './payment-ledger.service';
import { syncInspectionPaymentGate } from './invoice-payment-gate';

/** Body of an operator-recorded offline payment. */
export interface OfflinePaymentInput {
    amountCents: number;
    method: 'check' | 'cash' | 'offline' | 'other';
    occurredAt: Date;
    note?: string | null;
    allowOverpayment?: boolean;
    recordedBy: string;
}

/** Body of a payment correction. */
export interface PaymentCorrectionInput {
    correctedAmountCents: number;
    reason: string;
    recordedBy: string;
}

/**
 * Mark an invoice paid in full. Appends the outstanding remainder to the
 * payment ledger; the invoice's paid/partial/amount columns are then
 * recomputed from the ledger by its single writer, never set here.
 *
 * Returns the ledger row appended, or `null` when nothing was — an already
 * paid invoice, or one the ledger already covers. A caller pushing to an
 * external book of record must use that row's amount and id: the amount is
 * the REMAINDER collected on this occasion, which stops being the invoice
 * total the moment a deposit exists.
 */
export async function markPaid(
    db: DrizzleD1Database,
    id: string,
    tenantId: string,
    source: 'oi' | 'qbo' = 'oi',
    method?: PaymentMethod,
): Promise<AppendedPayment | null> {
    const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Invoice not found');
    // Idempotency: webhooks redeliver. A paid invoice stays paid with its
    // ORIGINAL timestamp — no double accounting, no date drift. Returning
    // null here is also what keeps a redelivery out of QuickBooks entirely,
    // rather than relying on their side to collapse a repeated requestid.
    if (existing.paidAt) return null;

    // Record how it was paid; keep any existing value if the caller omits one.
    const paymentMethod = method ?? existing.paymentMethod ?? null;
    if (paymentMethod !== existing.paymentMethod) {
        await db.update(invoices).set({ paymentMethod })
            .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId)));
    }

    const outstanding = existing.amountCents - await getNetReceivedCents(db, tenantId, id);
    void source; // consumed by route handler to decide QBO sync
    if (outstanding > 0) {
        return recordPayment(db, tenantId, {
            invoiceId: id,
            inspectionId: existing.inspectionId,
            kind: 'balance',
            amountCents: outstanding,
            method: paymentMethod ?? 'offline',
        });
    }
    // Nothing left to collect (a zero-total invoice, or the ledger
    // already covers it) — the cache still has to catch up.
    await recomputeInvoicePaymentState(db, tenantId, id);
    return null;
}

/**
 * Record money that already moved OUTSIDE the system — cash at the door, a
 * cheque in the post. Appends exactly one ledger row; the invoice's derived
 * columns are then recomputed by the ledger's single writer, never here.
 *
 * `occurredAt` is the caller's, not `now()`. The whole reason this endpoint
 * exists rather than another `markPaid` is that the inspector records
 * Tuesday's cash on Thursday, and a reporting period keyed on the write
 * time is quietly wrong every month.
 *
 * Overpayment is refused unless the caller confirms it: it is real (a client
 * rounds up) but far more often a decimal-point typo.
 */
export async function recordOfflinePayment(
    db: DrizzleD1Database,
    tenantId: string,
    id: string,
    input: OfflinePaymentInput,
): Promise<AppendedPayment> {
    const existing = await db.select().from(invoices)
        .where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Invoice not found');
    if (existing.voidedAt) throw Errors.Conflict('This invoice is void; it cannot take a payment.');

    // An invoice paid before the ledger existed has no rows at all, so the
    // outstanding figure below would read as the full total and every
    // further payment would look like an overpayment. Give it the one row
    // its own record implies first.
    await seedLedgerFromInvoiceRecord(db, tenantId, id);
    const outstanding = existing.amountCents - await getNetReceivedCents(db, tenantId, id);
    if (!input.allowOverpayment && input.amountCents > outstanding) {
        // No figure in the message: it would have to be raw minor units,
        // and the surface asking the question is already showing the
        // remaining balance formatted in the invoice's own currency.
        throw Errors.UnprocessableEntity(
            'This payment exceeds the outstanding balance on this invoice. Confirm the overpayment if the amount is right.',
        );
    }

    const appended = await recordPayment(db, tenantId, {
        invoiceId: id,
        inspectionId: existing.inspectionId,
        // A receipt against the invoice. `deposit` is reserved for money
        // taken at booking time, before any invoice exists to point at.
        kind: 'balance',
        amountCents: input.amountCents,
        method: input.method,
        // No provider and no provider_ref: this money moved outside every
        // system we integrate with, so there is nothing to reconcile against.
        provider: null,
        providerRef: null,
        recordedBy: input.recordedBy,
        note: input.note ?? null,
        occurredAt: input.occurredAt,
    });
    // `recordPayment` answers null only for a provider redelivery, and an
    // offline row carries no provider. Narrow rather than assert, so a
    // future change to that contract surfaces here instead of as a null
    // body on a 201.
    if (!appended) throw Errors.Conflict('This payment was already recorded.');
    return appended;
}

/**
 * Correct a mistyped payment. The original row SURVIVES; the correction is
 * a second row, because an append-only ledger is only reconcilable if
 * nothing in it is ever rewritten.
 *
 * The correcting row is a `refund`-kind row carrying `refundsId`, NOT a
 * signed `adjustment`. This is the choice a future reader will want to
 * reverse, so: `kind` carries direction in this table and `adjustment` is
 * ADDITIVE in the recompute, so a downward correction expressed as an
 * adjustment would have to smuggle a negative into `amount_cents` — the
 * exact thing the schema forbids, because an unfiltered SUM over a signed
 * column is a wrong total nobody notices. `refund` already means "money
 * going the other way" and `refunds_id` already means "the row this
 * reverses". Reusing them beats inventing a second mechanism that means
 * the same thing.
 *
 * It also inherits the ORIGINAL row's `occurred_at`: the money never moved
 * on the day the typo was spotted, so the correction belongs to the period
 * the mistake landed in, not to the day of data entry.
 *
 * Upward corrections are refused. More money arriving than was recorded is
 * not a correction, it is another payment, and recording it as one keeps
 * both facts true.
 */
export async function correctPayment(
    db: DrizzleD1Database,
    tenantId: string,
    id: string,
    paymentId: string,
    input: PaymentCorrectionInput,
) {
    const original = await db.select().from(orderPayments)
        .where(and(
            eq(orderPayments.tenantId, tenantId),
            eq(orderPayments.id, paymentId),
            eq(orderPayments.invoiceId, id),
        ))
        .get();
    if (!original) throw Errors.NotFound('Payment not found on this invoice');
    if (original.kind === 'refund') {
        throw Errors.UnprocessableEntity('A refund cannot be corrected. Record the money that actually moved instead.');
    }

    const alreadyCorrected = await db.select({ id: orderPayments.id }).from(orderPayments)
        .where(and(eq(orderPayments.tenantId, tenantId), eq(orderPayments.refundsId, paymentId)))
        .get();
    if (alreadyCorrected) {
        throw Errors.Conflict('This payment has already been corrected.');
    }

    const delta = original.amountCents - input.correctedAmountCents;
    if (delta <= 0) {
        throw Errors.UnprocessableEntity(
            'A correction can only lower a recorded payment. If more money arrived than was recorded, record the extra as its own payment.',
        );
    }

    const appended = await recordPayment(db, tenantId, {
        invoiceId: id,
        inspectionId: original.inspectionId,
        kind: 'refund',
        amountCents: delta,
        method: original.method,
        provider: null,
        providerRef: null,
        recordedBy: input.recordedBy,
        refundsId: original.id,
        note: `Correction: ${input.reason}`,
        occurredAt: original.occurredAt,
    });
    if (!appended) throw Errors.Conflict('This correction was already recorded.');

    // Lowering a payment can take the invoice back out of paid, and a
    // report left publicly unlocked with no backing payment is the whole
    // point of that gate existing.
    await syncInspectionPaymentGate(db, tenantId, original.inspectionId);

    // The caller renders this row, so it gets the fields the ledger row
    // actually carries rather than a plausible-looking guess.
    return { ...appended, method: original.method, note: `Correction: ${input.reason}`, refundsId: original.id };
}

/**
 * Every ledger row for one invoice, oldest movement first, with the
 * recording user's name resolved.
 *
 * Ordered by `occurred_at`, not `created_at`: the list is a record of when
 * money moved, and Thursday's data entry of Tuesday's cash belongs before
 * Wednesday's cheque. `created_at` breaks ties so the order is total.
 */
export async function listPayments(
    db: DrizzleD1Database,
    tenantId: string,
    id: string,
) {
    // Explicit column projection — a `select()` across this join runs at
    // D1's 100-column result cap for no benefit.
    const rows = await db.select({
        id: orderPayments.id,
        kind: orderPayments.kind,
        amountCents: orderPayments.amountCents,
        method: orderPayments.method,
        provider: orderPayments.provider,
        note: orderPayments.note,
        occurredAt: orderPayments.occurredAt,
        recordedBy: orderPayments.recordedBy,
        recordedByName: users.name,
        refundsId: orderPayments.refundsId,
    })
        .from(orderPayments)
        .leftJoin(users, eq(users.id, orderPayments.recordedBy))
        .where(and(eq(orderPayments.tenantId, tenantId), eq(orderPayments.invoiceId, id)))
        .orderBy(asc(orderPayments.occurredAt), asc(orderPayments.createdAt))
        .all();
    return rows.map(r => ({ ...r, occurredAt: safeISODate(r.occurredAt) }));
}

/**
 * Record that an invoice is partially paid. `amountPaidCents` is the
 * CUMULATIVE amount RECEIVED, in integer cents; remaining is derived by the
 * caller as `amountCents - amountPaidCents` because the invoice total is
 * the money authority, not any external system's view of it.
 *
 * The amount is REQUIRED. It used to be optional, meaning "partial, amount
 * unknown", which cleared any figure already captured. With a ledger there
 * is no such state: every partial payment is one or more rows, and the sum
 * of rows is always a known number. Making the parameter required is what
 * makes that branch unreachable rather than merely unused — it cannot be
 * called without one.
 *
 * The ledger row appended is the DELTA between the reported cumulative
 * figure and what the ledger already holds, so a repeated sync of the same
 * figure appends nothing and a figure that went DOWN records a refund.
 *
 * Returns the appended row (or `null` when the figure had not moved) on the
 * same contract as `markPaid`.
 */
export async function markPartial(
    db: DrizzleD1Database,
    id: string,
    tenantId: string,
    source: 'oi' | 'qbo' = 'oi',
    amountPaidCents: number,
): Promise<AppendedPayment | null> {
    const existing = await db.select().from(invoices).where(and(eq(invoices.id, id), eq(invoices.tenantId, tenantId))).get();
    if (!existing) throw Errors.NotFound('Invoice not found');

    const delta = amountPaidCents - await getNetReceivedCents(db, tenantId, id);
    if (delta === 0) {
        await recomputeInvoicePaymentState(db, tenantId, id);
        return null;
    }
    return recordPayment(db, tenantId, {
        invoiceId: id,
        inspectionId: existing.inspectionId,
        kind: delta > 0 ? 'balance' : 'refund',
        amountCents: Math.abs(delta),
        method: existing.paymentMethod ?? 'other',
        provider: source === 'qbo' ? 'qbo' : null,
    });
}

/**
 * Refund an invoice: appends a `refund` row reversing everything received,
 * rather than nulling the columns. A fully refunded invoice therefore reads
 * as "45000 received, 45000 refunded, 0 outstanding received" instead of a
 * blank slate — more truthful, and the only version a reconciliation can
 * check. An invoice paid before the ledger existed is seeded from its own
 * record first, so there is something to reverse.
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
