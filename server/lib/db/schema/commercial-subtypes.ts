import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

export const commercialSubtypes = sqliteTable('commercial_subtypes', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id),
    name:        text('name').notNull(),
    // NO READER OR WRITER FOUND — nothing outside the schema barrel touches this
    // column or this table. The live tenant-defined subtype list is
    // `inspection_types` (schema/inspection/automation.ts), which carries its own
    // `based_on` soft ref to a platform property-subtype slug.
    basedOn:     text('based_on'),
    description: text('description'),
    disabled:    integer('is_disabled', { mode: 'boolean' }).notNull().default(false),
    createdAt:   integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    tenantNameUnique: uniqueIndex('idx_commercial_subtypes_tenant_name').on(t.tenantId, t.name),
}));
