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
    // B1 — `in_app` templates carry a notice's wording. Type-layer only.
    channel:   text('channel', { enum: ['email', 'sms', 'in_app'] }).notNull(),
    // `subject` is REUSED as the in-app notice TITLE rather than given a
    // column of its own: a notice header has exactly one short line above its
    // body, which is the same shape and the same authoring job as an email
    // subject. A parallel `title` column would mean every template editor,
    // validator and seed had to learn which of two near-identical fields
    // applies to which channel.
    subject:   text('subject'),                 // email subject / in_app notice title; null for sms
    body:      text('body').notNull(),          // email HTML / sms plain-text / in_app notice body
    variables: text('variables'),               // JSON string[] of declared merge vars
    isSeeded:  integer('is_seeded', { mode: 'boolean' }).notNull().default(false),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_message_templates_tenant_channel').on(t.tenantId, t.channel),
]);
