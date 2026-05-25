/**
 * Design System 0520 subsystem E phase 4 — IdentitySwitcher (M20).
 *
 * One row per (primary user → linked seat) association. The
 * IdentityService.list builds the switcher menu from this table; the
 * switch route copies the linked seat's tenantId + role into a fresh
 * JWT, then sets the canonical cookie so subsequent requests are
 * scoped to that workspace.
 *
 * `linkedRole` mirrors the workspace role of the linked user (admin /
 * inspector / lead / specialist / apprentice / office). `linkedDisplay-
 * Name` snapshots the tenant + display name at link-time so the menu
 * can render without a per-row join.
 */
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';

export const userIdentityLinks = sqliteTable('user_identity_links', {
    id:                 text('id').primaryKey(),
    primaryUserId:      text('primary_user_id').notNull(),
    linkedUserId:       text('linked_user_id').notNull(),
    linkedTenantId:     text('linked_tenant_id').notNull(),
    linkedRole:         text('linked_role').notNull(),
    linkedDisplayName:  text('linked_display_name').notNull(),
    createdAt:          text('created_at').notNull(),
});
