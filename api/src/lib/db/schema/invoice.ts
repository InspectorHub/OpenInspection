import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
    amountCents: integer('amount_cents').notNull().default(0),
    lineItems: text('line_items', { mode: 'json' }).notNull().$type<Array<{ description: string; amountCents: number; quantity?: number; unitAmountCents?: number }>>().default([]),
    dueDate: text('due_date'),
    notes: text('notes'),
    sentAt: integer('sent_at', { mode: 'timestamp' }),
    paidAt: integer('paid_at', { mode: 'timestamp' }),
    partialPaidAt: integer('partial_paid_at', { mode: 'timestamp' }),
    qboSyncStatus: text('qbo_sync_status', { enum: ['synced', 'pending', 'failed'] }),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
});
