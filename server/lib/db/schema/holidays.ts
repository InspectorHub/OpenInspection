import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Tenant-defined company closed days merged into the holiday catalog when
 * `holiday_region` is set. Civil date only (YYYY-MM-DD); no DB FKs.
 */
export const tenantCustomHolidays = sqliteTable('tenant_custom_holidays', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Calendar-semantic civil date stored as YYYY-MM-DD, without a time zone. */
    date: text('date').notNull(),
    name: text('name').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // One row per (tenant, date). The unique index is also the read index —
    // there used to be a second, non-unique index on exactly these two columns,
    // which could only ever duplicate this one's work and the writes to it.
    uniqueIndex('uq_tenant_custom_holidays_tenant_date').on(t.tenantId, t.date),
]);
