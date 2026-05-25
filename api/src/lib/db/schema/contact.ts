import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';
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
});
