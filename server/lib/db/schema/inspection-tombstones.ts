import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core';

/**
 * One row per inspection that was HARD-deleted, so a create replayed afterwards cannot bring it back.
 *
 * A client that mints its own inspection id (an offline device) can replay a queued create long after the
 * inspection was deleted. The id only protects while the row exists; this row is what outlives it. Written by
 * the inspection delete cascade BEFORE anything is removed; read by `POST /api/inspections` for a request that
 * names its own id, and by the offline package importer.
 *
 * Holds an opaque id, the company and the instant, and nothing else: no actor, no address, no client. It is not
 * a signing record and is never read to decide anything about a signature. It is removed with the company by the
 * tenant purge (it carries `tenant_id`). Rows do not expire: an id that came back to life is the bug this table
 * exists to prevent, and a row is about 60 bytes.
 *
 * Referential integrity is enforced by the service layer (no foreign keys).
 */
export const inspectionTombstones = sqliteTable('inspection_tombstones', {
    tenantId:     text('tenant_id').notNull(),
    inspectionId: text('inspection_id').notNull(),
    deletedAt:    integer('deleted_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    primaryKey({ columns: [t.tenantId, t.inspectionId] }),
]);

export type InspectionTombstone = typeof inspectionTombstones.$inferSelect;
