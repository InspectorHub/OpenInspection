import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

export const commercialSubtypes = sqliteTable('commercial_subtypes', {
    id:          text('id').primaryKey(),
    tenantId:    text('tenant_id').notNull().references(() => tenants.id),
    name:        text('name').notNull(),
    basedOn:     text('based_on'),
    description: text('description'),
    disabled:    integer('disabled').notNull().default(0),
    createdAt:   integer('created_at').notNull(),
}, (t) => ({
    tenantNameUnique: uniqueIndex('idx_commercial_subtypes_tenant_name').on(t.tenantId, t.name),
}));
