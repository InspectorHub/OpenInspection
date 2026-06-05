import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { tenants } from './tenant';

export const contacts = sqliteTable('contacts', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull().references(() => tenants.id),
    type: text('type', { enum: ['agent', 'client'] }).notNull().default('client'),
    name: text('name').notNull(),
    email: text('email'),
    phone: text('phone'),
    agency: text('agency'),
    notes: text('notes'),
    createdByUserId: text('created_by_user_id'),
    createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
    // DB-9: soft-delete timestamp. When set, the row is excluded from the
    // active-contact unique index so a replacement active row can coexist.
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
}, (t) => [
    index('idx_contacts_type').on(t.tenantId, t.type),
    index('idx_contacts_tenant').on(t.tenantId),
    // DB-9: one ACTIVE contact per (tenant,email); NULL emails and archived rows don't collide.
    uniqueIndex('uq_contacts_tenant_email').on(t.tenantId, t.email).where(sql`email IS NOT NULL AND archived_at IS NULL`),
]);
