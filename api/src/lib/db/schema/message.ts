import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import { inspections } from './inspection';
import { tenants } from './tenant';

export interface MessageAttachment {
    id: string;
    key: string;
    name: string;
    size: number;
    type: string;
    uploadedAt: number;
}

export const customerMessages = sqliteTable('customer_messages', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull().references(() => tenants.id),
    inspectionId: text('inspection_id').notNull().references(() => inspections.id, { onDelete: 'cascade' }),
    fromRole:     text('from_role', { enum: ['client', 'inspector'] }).notNull(),
    fromName:     text('from_name'),
    body:         text('body').notNull(),
    attachments:  text('attachments', { mode: 'json' }).$type<MessageAttachment[]>(),
    readAt:       integer('read_at'),
    createdAt:    integer('created_at').notNull(),
}, (t) => ({
    inspectionIdx: index('idx_msg_inspection').on(t.inspectionId, t.createdAt),
    unreadIdx:     index('idx_msg_unread')
        .on(t.tenantId, t.inspectionId, t.fromRole)
        .where(sql`${t.readAt} IS NULL`),
}));
