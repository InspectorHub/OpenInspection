import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';
import { inspections } from './inspection';
import { contacts } from './contact';

export const invoices = sqliteTable('invoices', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').references(() => inspections.id),
    contactId: text('contact_id').references(() => contacts.id),
    clientName: text('client_name'),
    clientEmail: text('client_email'),
    // P-4 authority chain (tier 1): when an invoice exists its amountCents is
    // authoritative over service-snapshot sums and inspections.price. See
    // getEffectivePriceCents() in server/lib/effective-price.ts.
    amountCents: integer('amount_cents').notNull().default(0),
    lineItems: text('line_items', { mode: 'json' }).notNull().$type<Array<{ description: string; amountCents: number; quantity?: number; unitAmountCents?: number }>>().default([]),
    // Calendar-semantic YYYY-MM-DD (invoice due date, no time component) — intentionally
    // TEXT per the Schema Rules calendar-field exception, not an epoch timestamp.
    dueDate: text('due_date'),
    notes: text('notes'),
    sentAt: integer('sent_at', { mode: 'timestamp_ms' }),
    paidAt: integer('paid_at', { mode: 'timestamp_ms' }),
    // How the invoice was paid — 'card' (online Stripe) or an offline method
    // (check / cash / offline) recorded by the inspector via "Mark as paid".
    paymentMethod: text('payment_method', { enum: ['card', 'check', 'cash', 'offline', 'other'] }),
    partialPaidAt: integer('partial_paid_at', { mode: 'timestamp_ms' }),
    // Accounting void (QuickBooks-style): a voided invoice stays in the ledger at $0
    // with its audit trail intact and is excluded from all revenue rollups. Distinct
    // from refund (paid->unpaid). See spec 2026-06-22 #182.
    voidedAt: integer('voided_at', { mode: 'timestamp_ms' }),
    qboSyncStatus: text('qbo_sync_status', { enum: ['synced', 'pending', 'failed'] }),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    // i18n Phase B — the currency (ISO 4217) this invoice was created in, snapshot
    // from tenant_configs.currency at creation. Amounts stay integer cents; this is
    // the metadata that keeps a historical record self-describing, so a later tenant
    // currency change never re-labels a paid invoice. Appended at table end.
    currency: text('currency').notNull().default('USD'),
    // How much has actually been received on a partially-paid invoice. NULL on
    // draft/sent/paid/void — only a 'partial' invoice carries one, and it is
    // cleared whenever the invoice reaches paid or is refunded so the amount can
    // never contradict the status derived from paidAt/partialPaidAt.
    //
    // Stores the amount PAID, not a remaining balance: amountCents above is the
    // authoritative total (money authority chain, tier 1), so remaining is
    // derived as amountCents - amountPaidCents. Persisting an external system's
    // remaining balance would state a remainder computed against THAT system's
    // total, which drifts from ours the first time either side edits the
    // invoice. Appended at table end. See #273.
    amountPaidCents: integer('amount_paid_cents'),
}, (t) => [
    index('idx_invoices_tenant').on(t.tenantId),
    index('idx_invoices_inspection').on(t.inspectionId),
    index('idx_invoices_contact').on(t.tenantId, t.contactId),
]);
