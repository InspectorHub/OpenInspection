import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { PermissionOverrides } from '../../auth/capabilities';

/**
 * A company's own permission template: a name, a base role and a sparse set of
 * capability switches that differ from that role's defaults. The company-defined
 * counterpart of the built-in templates in `server/lib/auth/permission-templates.ts`.
 *
 * Applying a template COPIES it: the role and the switch diff are stamped onto the
 * invite or the member, and nothing links back. Editing or archiving a template
 * therefore never changes anyone who already received it. For the same reason no
 * `users` column records which template a person came from; the Team page works
 * that out by comparing resolved capabilities.
 *
 * `overrides` is read through the capability whitelist, so a key a newer version
 * wrote is ignored by an older one rather than failing the read, and a key added
 * later is simply absent here (= the role default).
 *
 * Names are unique per company among non-archived rows, so an archived name can be
 * used again. `created_by` is a soft reference to `users.id` (no foreign key); a
 * removed member is soft-deleted, so the reference stays resolvable.
 *
 * Referential integrity is enforced by the service layer (no foreign keys). A
 * tenant purge removes the rows (they carry `tenant_id`).
 */
export const permissionTemplates = sqliteTable('permission_templates', {
    id:         text('id').primaryKey(),
    tenantId:   text('tenant_id').notNull(),
    name:       text('name').notNull(),
    // Not owner (never reducible) and not agent (never a team member).
    baseRole:   text('base_role', { enum: ['manager', 'inspector', 'staff'] }).notNull(),
    overrides:  text('overrides', { mode: 'json' }).$type<PermissionOverrides>().notNull(),
    createdBy:  text('created_by'),
    createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:  integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    archivedAt: integer('archived_at', { mode: 'timestamp_ms' }),
}, (t) => [
    uniqueIndex('uq_permission_templates_name').on(t.tenantId, t.name).where(sql`archived_at IS NULL`),
]);

export type PermissionTemplateRow = typeof permissionTemplates.$inferSelect;
export type NewPermissionTemplateRow = typeof permissionTemplates.$inferInsert;
