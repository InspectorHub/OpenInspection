import { sqliteTable, text, integer, primaryKey, index } from 'drizzle-orm/sqlite-core';

/**
 * Queued writes an offline package has already applied, one row per (tenant, key, inspection).
 *
 * The 24 hour idempotency ledger is not enough on its own: an `inspection.update`
 * carried by a package is a PATCH, a last-writer-wins overwrite, so replaying it
 * after the ledger row expired would put an old value over a newer edit. This
 * table is what keeps a repeat import from doing that, for as long as the row
 * exists.
 *
 * An `inspection.create` is recorded as well. The client-chosen id only keeps a
 * create from running twice while the inspection exists; once it is deleted, the
 * record is what tells the importer not to bring it back. For that reason the
 * inspection delete cascade leaves this table alone.
 *
 * Rows are written only after the target route answered 2xx. A row can only be
 * matched by a package that is still importable, and a package is refused once it
 * is older than `PACKAGE_MAX_AGE_DAYS`, so an import deletes this workspace's rows
 * older than that age plus a margin (`sweepAppliedRecords`), a bounded batch at a
 * time. `idx_offline_import_applied_age` serves that delete.
 *
 * Referential integrity is enforced by the service layer (no foreign keys).
 */
export const offlineImportApplied = sqliteTable('offline_import_applied', {
    tenantId:       text('tenant_id').notNull(),
    // The queue entry's idempotency key, verbatim as the device minted it. The device mints it, so
    // nothing stops two packages from using the same one for different inspections: the inspection id
    // is part of the primary key, and a record only counts for the inspection it was written for.
    idempotencyKey: text('idempotency_key').notNull(),
    op:             text('op', { enum: ['inspection.create', 'inspection.update', 'inspection.complete'] }).notNull(),
    inspectionId:   text('inspection_id').notNull(),
    appliedAt:      integer('applied_at', { mode: 'timestamp_ms' }).notNull(),
    // The importing member, taken from the verified session.
    appliedBy:      text('applied_by').notNull(),
}, (t) => [
    primaryKey({ columns: [t.tenantId, t.idempotencyKey, t.inspectionId] }),
    index('idx_offline_import_applied_age').on(t.tenantId, t.appliedAt),
]);

export type OfflineImportApplied = typeof offlineImportApplied.$inferSelect;
