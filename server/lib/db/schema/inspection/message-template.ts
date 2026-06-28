import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * SP2 — reusable, per-tenant message templates referenced by automations.
 * App-layer tenant filtering only (ScopedDB); no `.references()` per OI schema
 * rules. A template is channel-specific: `email` (HTML `body` + optional
 * `subject`) OR `sms` (plain-text `body`, `subject` null). `variables` is a
 * JSON-encoded string[] of declared merge-var names (the hub helper catalog).
 *
 * Named `message_templates` because the `templates` physical name is already
 * taken by rating-system inspection templates (see `template-rating.ts`).
 */
export const messageTemplates = sqliteTable('message_templates', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    name:      text('name').notNull(),
    channel:   text('channel', { enum: ['email', 'sms'] }).notNull(),
    subject:   text('subject'),                 // email only; null for sms
    body:      text('body').notNull(),          // email HTML / sms plain-text
    variables: text('variables'),               // JSON string[] of declared merge vars
    isSeeded:  integer('is_seeded', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_message_templates_tenant_channel').on(t.tenantId, t.channel),
]);
