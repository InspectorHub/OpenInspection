import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Which ZIPs an inspector will travel to.
 *
 * Absence is the meaningful state: an inspector with ZERO rows serves
 * everywhere, mirroring `service_inspectors` (zero rows for a service = every
 * inspector qualifies). That default is what keeps this feature opt-in — a
 * workspace that never opens the panel behaves exactly as it did before.
 *
 * `zip_prefix` is stored as typed, uppercased and trimmed. v1 matches a
 * property ZIP by PREFIX, so '787' covers all of 787xx and '78701' covers only
 * itself; the comparison lives in `server/lib/booking/eligibility.ts` and is
 * the only place that knows the rule.
 *
 * No FKs per Schema Rules — `user_id` is an app-layer reference to `users.id`,
 * and the API deletes rows by (tenant, user) rather than relying on cascade.
 */
export const inspectorServiceAreas = sqliteTable('inspector_service_areas', {
    id:        text('id').primaryKey(),
    tenantId:  text('tenant_id').notNull(),
    userId:    text('user_id').notNull(),
    zipPrefix: text('zip_prefix').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_inspector_service_areas_tenant').on(t.tenantId),
    index('idx_inspector_service_areas_user').on(t.tenantId, t.userId),
    // One row per (tenant, inspector, prefix). Saving the same list twice must
    // not double it; the replace-list write deletes then inserts, and this
    // index is what makes a partially-applied replace impossible to paper over.
    uniqueIndex('uq_inspector_service_areas').on(t.tenantId, t.userId, t.zipPrefix),
]);
