/**
 * Design System 0520 subsystem E phase 4 — IdentitySwitcher (M20).
 *
 * One row per (primary user → linked seat) association. The
 * IdentityService.list builds the switcher menu from this table; the
 * switch route copies the linked seat's tenantId + role into a fresh
 * JWT, then sets the canonical cookie so subsequent requests are
 * scoped to that workspace.
 *
 * `linkedRole` mirrors the workspace role of the linked user
 * (owner / admin / inspector / agent). `linkedDisplayName` snapshots the
 * tenant + display name at link-time so the menu can render without a
 * per-row join.
 */
import { sqliteTable, text, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const userIdentityLinks = sqliteTable('user_identity_links', {
    id:                 text('id').primaryKey(),
    primaryUserId:      text('primary_user_id').notNull(),
    linkedUserId:       text('linked_user_id').notNull(),
    linkedTenantId:     text('linked_tenant_id').notNull(),
    linkedRole:         text('linked_role').notNull(),
    linkedDisplayName:  text('linked_display_name').notNull(),
    createdAt:          text('created_at').notNull().default(sql`(datetime('now'))`),
}, (t) => [
    index('idx_user_identity_links_primary').on(t.primaryUserId),
    uniqueIndex('uq_user_identity_links_primary_linked').on(t.primaryUserId, t.linkedUserId),
]);
