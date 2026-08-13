import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';
import { tenants } from './core';

/**
 * Email-template Phase 3 — sparse per-tenant overrides for transactional
 * email templates. One row per (tenant, trigger) the tenant has customized;
 * absence = pure registry default. `subject`/`blocks` null = use default for
 * that field; `blocks` is a partial { blockKey: value } map (only overridden
 * keys). `enabled=false` stops that email being sent (ignored for `required`
 * templates, which the API refuses to disable).
 */
export const emailTemplates = sqliteTable('email_templates', {
    tenantId:  text('tenant_id').notNull().references(() => tenants.id),
    trigger:   text('trigger').notNull(),
    subject:   text('subject'),
    blocks:    text('blocks', { mode: 'json' }).$type<Record<string, string>>(),
    enabled:   integer('is_enabled', { mode: 'boolean' }).notNull().default(true),
    updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    pk: primaryKey({ columns: [t.tenantId, t.trigger] }),
}));
