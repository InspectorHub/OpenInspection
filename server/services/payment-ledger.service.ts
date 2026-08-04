/**
 * The payment ledger.
 *
 * A payment is a ROW here, never a column on the invoice. `order_payments` is
 * append-only — a correction is a new row — and it records what was RECEIVED,
 * never what is OWED: the total keeps coming from the money-authority chain
 * (`getEffectivePriceCents()`), and these two functions are the ONLY writers of
 * the invoice's derived payment state (`paid_at`, `partial_paid_at`,
 * `amount_paid_cents`). A second writer does not fail any behavioural test; it
 * just makes the cache disagree with the money weeks later.
 *
 * See spec 2026-08-01 payment/deposit flow §3.
 */
import { and, eq, isNotNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { orderPayments } from '../lib/db/schema/order-payment';
import { invoices } from '../lib/db/schema/invoice';
import { Errors } from '../lib/errors';

/** Accepts the D1 drizzle instance in production and better-sqlite3 in tests. */
type AnyDb = DrizzleD1Database<Record<string, unknown>> | { [k: string]: unknown };

export type PaymentKind = 'deposit' | 'balance' | 'adjustment' | 'refund';
export type PaymentMethodKind = 'card' | 'check' | 'cash' | 'offline' | 'other';
export type PaymentProvider = 'stripe' | 'qbo';

export interface PaymentEntry {
    /** The order the money is against. Resolved from the invoice when omitted. */
    inspectionId?: string | null;
    /** Set once an invoice exists; a booking deposit predates one. */
    invoiceId?: string | null;
    kind: PaymentKind;
    /** ALWAYS POSITIVE. Direction is carried by `kind`, never by the sign. */
    amountCents: number;
    method: PaymentMethodKind;
    provider?: PaymentProvider | null;
    /** Processor id — the idempotency key for a redelivered webhook. */
    providerRef?: string | null;
    recordedBy?: string | null;
    refundsId?: string | null;
    note?: string | null;
    /** When the money MOVED, not when the row was written. Defaults to now. */
    occurredAt?: Date;
}

/** Receipts add, refunds subtract. Nothing else is a direction. */
const signOf = (kind: PaymentKind): 1 | -1 => (kind === 'refund' ? -1 : 1);

/**
 * Append one payment and refresh the invoice cache it affects.
 *
 * Returns `true` when a row was appended and `false` when the entry was a
 * redelivery of one already recorded — the caller can log the difference, which
 * is the whole reason this is not `void`.
 */
export async function recordPayment(
    rawDb: AnyDb,
    tenantId: string,
    entry: PaymentEntry,
): Promise<boolean> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;

    if (!Number.isInteger(entry.amountCents) || entry.amountCents <= 0) {
        throw new Error('order_payments.amount_cents must be a positive integer; direction belongs in `kind`');
    }

    let inspectionId = entry.inspectionId ?? null;
    const invoiceId = entry.invoiceId ?? null;

    if (invoiceId) {
        const inv = await db.select({ id: invoices.id, inspectionId: invoices.inspectionId })
            .from(invoices)
            .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
            .get();
        if (!inv) throw Errors.NotFound('Invoice not found');
        // A standalone invoice has no order; that row is legitimately order-less.
        inspectionId = inspectionId ?? (inv.inspectionId as string | null);
    }

    if (!inspectionId && !invoiceId) {
        throw new Error('order_payments needs at least one of inspection_id / invoice_id');
    }

    // The unique index is the real guard, but it only covers provider-backed
    // rows (SQLite treats NULLs as distinct), and hitting it would throw rather
    // than answering "was this a redelivery?". Ask first, then let
    // onConflictDoNothing absorb the race.
    if (entry.provider && entry.providerRef) {
        const dup = await db.select({ id: orderPayments.id }).from(orderPayments)
            .where(and(
                eq(orderPayments.tenantId, tenantId),
                eq(orderPayments.provider, entry.provider),
                eq(orderPayments.providerRef, entry.providerRef),
            ))
            .get();
        if (dup) return false;
    }

    const now = new Date();
    await db.insert(orderPayments).values({
        id: crypto.randomUUID(),
        tenantId,
        inspectionId,
        invoiceId,
        kind: entry.kind,
        amountCents: entry.amountCents,
        method: entry.method,
        provider: entry.provider ?? null,
        providerRef: entry.providerRef ?? null,
        recordedBy: entry.recordedBy ?? null,
        refundsId: entry.refundsId ?? null,
        note: entry.note ?? null,
        occurredAt: entry.occurredAt ?? now,
        createdAt: now,
    }).onConflictDoNothing();

    if (invoiceId) await recomputeInvoicePaymentState(db, tenantId, invoiceId);
    return true;
}

/**
 * Recompute an invoice's cached payment state from its ledger rows. THE ONLY
 * writer of `paid_at` / `partial_paid_at` / `amount_paid_cents`.
 *
 * `amount_paid_cents` holds the CUMULATIVE amount received — receipts minus
 * refunds — not a remaining balance: `invoices.amount_cents` is the
 * authoritative total, so remaining is derived against it by the reader.
 */
export async function recomputeInvoicePaymentState(
    rawDb: AnyDb,
    tenantId: string,
    invoiceId: string,
): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;

    const inv = await db.select({ id: invoices.id, amountCents: invoices.amountCents })
        .from(invoices)
        .where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)))
        .get();
    if (!inv) return;

    // Explicit column projection, not select(): a wide invoice JOIN would run at
    // D1's 100-column result cap, and we need three numbers.
    const rows: Array<{ kind: PaymentKind; amountCents: number; occurredAt: Date | number | null }> =
        await db.select({
            kind: orderPayments.kind,
            amountCents: orderPayments.amountCents,
            occurredAt: orderPayments.occurredAt,
        })
            .from(orderPayments)
            .where(and(
                eq(orderPayments.tenantId, tenantId),
                eq(orderPayments.invoiceId, invoiceId),
                isNotNull(orderPayments.invoiceId),
            ))
            .all();

    // No rows at all means the ledger has nothing to say about this invoice —
    // NOT that nothing was paid. An invoice marked paid before the ledger
    // existed is exactly that case, and zeroing it would erase a real payment.
    if (rows.length === 0) return;

    let netCents = 0;
    let lastMovedAt = 0;
    for (const r of rows) {
        netCents += signOf(r.kind) * r.amountCents;
        // The LATEST movement by when the money moved — not the last row the
        // query happened to return. Rows arrive in insertion order, and an
        // inspector records Tuesday's cash on Thursday.
        const ms = r.occurredAt instanceof Date ? r.occurredAt.getTime() : Number(r.occurredAt ?? 0);
        if (ms > lastMovedAt) lastMovedAt = ms;
    }
    const movedAt = new Date(lastMovedAt);

    const total = inv.amountCents as number;
    const paidInFull = total > 0 && netCents >= total;
    const partiallyPaid = !paidInFull && netCents > 0;

    await db.update(invoices).set({
        paidAt: paidInFull ? movedAt : null,
        partialPaidAt: partiallyPaid ? movedAt : null,
        amountPaidCents: netCents,
    }).where(and(eq(invoices.tenantId, tenantId), eq(invoices.id, invoiceId)));
}
