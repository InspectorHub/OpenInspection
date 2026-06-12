import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

// Comments-repair fold (2026-06-12) — tenant-scoped, customizable list of
// recommended contractor types (e.g. "Licensed Electrician"). No .references()
// per schema rules; tenant filtering is enforced at the application layer.
export const contractorTypes = sqliteTable('contractor_types', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_contractor_types_tenant').on(t.tenantId),
]);
