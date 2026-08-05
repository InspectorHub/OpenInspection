import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * The payment ledger — append-only, one row per movement of money against an
 * ORDER. It records what was RECEIVED, never what is OWED: the total keeps
 * coming from the money-authority chain (`getEffectivePriceCents()`), and the
 * invoice's `paid_at` / `partial_paid_at` / `amount_paid_cents` become a
 * denormalized cache recomputed from these rows by a single writer.
 *
 * Append-only means no UPDATE and no DELETE — a correction is a new row, which
 * is what makes the ledger reconcilable. There is exactly ONE exception, and it
 * is not a correction: `invoice_id` is written once onto rows that predate the
 * invoice, at the moment the invoice is raised.
 *
 * See spec 2026-08-01 payment/deposit flow §3.
 */
export const orderPayments = sqliteTable('order_payments', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    // The ORDER is the primary key of a payment. A booking deposit is taken
    // before any invoice exists (`booking.service.ts` creates none), so keying
    // this table on the invoice would make `kind: 'deposit'` unrepresentable —
    // and this table is append-only and financial, the worst kind to re-key.
    //
    // Nullable only because a STANDALONE invoice is a real product state
    // (`invoices.inspection_id` is nullable and the New Invoice form submits
    // null when the field is blank); a payment against one has no order to
    // point at. The invariant is "at least one of inspection_id / invoice_id",
    // enforced in `recordPayment` — never both null.
    inspectionId: text('inspection_id'),
    // A LINK, not identity: null until an invoice exists, then set — and
    // backfilled onto the deposit rows that predate it.
    invoiceId: text('invoice_id'),
    // Direction lives here, not in the sign of amountCents — an unfiltered
    // SUM over a signed column is a wrong total nobody notices.
    kind: text('kind', { enum: ['deposit', 'balance', 'adjustment', 'refund'] }).notNull(),
    amountCents: integer('amount_cents').notNull(),          // always positive
    method: text('method', { enum: ['card', 'check', 'cash', 'offline', 'other'] }).notNull(),
    provider: text('provider', { enum: ['stripe', 'qbo'] }), // null = offline
    // Idempotency key. Stripe redelivers webhooks; the unique index below is the
    // guard, in the database rather than in a handler someone can refactor.
    providerRef: text('provider_ref'),
    recordedBy: text('recorded_by'),                         // user id, null when automated
    refundsId: text('refunds_id'),                           // kind='refund' -> the row it reverses
    note: text('note'),
    // When the money MOVED, not when the row was written — an inspector records
    // Tuesday's cash on Thursday, and reporting periods key on the former.
    occurredAt: integer('occurred_at', { mode: 'timestamp_ms' }).notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // The order index is the one the deposit surfaces read — total / paid /
    // remaining are answered per ORDER, whether or not an invoice exists yet.
    index('idx_order_payments_inspection').on(t.tenantId, t.inspectionId),
    index('idx_order_payments_invoice').on(t.tenantId, t.invoiceId),
    // SQLite treats NULLs as DISTINCT in a unique index, so two offline rows
    // (provider and provider_ref both NULL) never collide — which is correct
    // here, a customer may hand over two identical $100 cash payments. The
    // consequence to keep in mind: this index guards PROVIDER-BACKED rows only.
    // An offline path that needs dedupe must bring its own key; do not assume
    // this constraint is doing it.
    uniqueIndex('uq_order_payments_provider_ref').on(t.tenantId, t.provider, t.providerRef),
]);

export type OrderPayment = typeof orderPayments.$inferSelect;
export type NewOrderPayment = typeof orderPayments.$inferInsert;
