import { sql } from 'drizzle-orm';
import { sqliteTable, text, integer, index, uniqueIndex, check } from 'drizzle-orm/sqlite-core';

/** Longest `cursor` or `counts` text a job row may hold, in characters. Enforced by a CHECK constraint, not only by callers. */
export const DATA_JOB_TEXT_MAX_CHARS = 4096;

/** Which way the data moves. */
export const DATA_JOB_KINDS = ['export', 'import'] as const;

/** `queued` and `running` are the active states; the rest are terminal and free the company's single job slot. */
export const DATA_JOB_STATUSES = ['queued', 'running', 'complete', 'failed', 'cancelled', 'expired'] as const;

/** Named members of the job-status axis, so writers derive from a constant instead of a bare literal. */
export const DATA_JOB_STATUS = {
    QUEUED: 'queued',
    RUNNING: 'running',
    COMPLETE: 'complete',
    FAILED: 'failed',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
} as const satisfies Record<string, (typeof DATA_JOB_STATUSES)[number]>;

/** The stages a desktop client reports. All seven are shared by export and import; the server only records them. */
export const DATA_JOB_STAGES = [
    'rows', 'media', 'finish', 'upload', 'preview', 'apply', 'revert',
] as const;

/** The only failure reasons a job row may record: fixed codes, never a message and never any content from the data. */
export const DATA_JOB_ERROR_CODES = [
    'storage_unavailable', 'database_unavailable', 'quota_exceeded', 'package_invalid',
    'package_checksum_mismatch', 'package_unsupported_version', 'limit_exceeded', 'cancelled_by_user', 'internal',
] as const;

/**
 * One export or import of a company's data package.
 *
 * The desktop client owns the work and reports progress; the server keeps only a lease and progress ledger.
 * `stage` is the client-reported step and `cursor` is the client's most recent checkpoint — for display and
 * cross-device hints only, never something the server drives. `cursor` is opaque serialized state capped at
 * DATA_JOB_TEXT_MAX_CHARS by a CHECK constraint so a runaway writer cannot grow a row towards the database's
 * per-row ceiling. `counts` is a small serialized map of counts under the same cap.
 *
 * One active job per company: the partial unique index `uq_tenant_data_jobs_active` admits at most one
 * row whose status is `queued` or `running`. Starting a job is therefore a plain insert that the
 * database refuses when another is active; no read-then-write race exists. A terminal status leaves the
 * index, which is how the slot is freed. The vocabularies are enforced by the typed schema, not by a CHECK
 * constraint, so every writer must go through it: a raw write of a status the index does not match
 * (`Running`, say) would not hold the slot.
 *
 * `package_id` names the produced (or inbound) package and is minted once. `bytes` and `sha256` are the
 * client-declared attestation values for that package, not a server-side proof. `lease_holder` is a
 * non-PII device label; `lease_expires_at` is when the lease lapses and another device may take the job
 * (renewed in >=5-minute writes by the client), and the expiry sweep marks the job `expired`. `client_kind`
 * records which desktop platform holds the lease. `error_code` is one of DATA_JOB_ERROR_CODES, set with a
 * `failed` status.
 *
 * The row holds ids, counts and sizes only; nothing from the company's records. Referential integrity is
 * enforced by the service layer (no foreign keys). A tenant purge removes the rows (they carry `tenant_id`).
 * Every read or write must be scoped by `tenant_id` taken from the verified session.
 */
export const tenantDataJobs = sqliteTable('tenant_data_jobs', {
    id:         text('id').primaryKey(),
    tenantId:   text('tenant_id').notNull(),
    kind:       text('kind', { enum: DATA_JOB_KINDS }).notNull(),
    status:     text('status', { enum: DATA_JOB_STATUSES }).notNull(),
    stage:      text('stage', { enum: DATA_JOB_STAGES }).notNull(),
    cursor:     text('cursor'),
    packageId:  text('package_id'),
    bytes:      integer('bytes').notNull().default(0),
    sha256:     text('sha256'),
    counts:     text('counts'),
    errorCode:  text('error_code', { enum: DATA_JOB_ERROR_CODES }),
    createdBy:  text('created_by').notNull(),
    createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    startedAt:  integer('started_at', { mode: 'timestamp_ms' }),
    updatedAt:  integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    finishedAt:  integer('finished_at', { mode: 'timestamp_ms' }),
    leaseHolder:    text('lease_holder'),
    leaseExpiresAt: integer('lease_expires_at', { mode: 'timestamp_ms' }),
    clientKind:     text('client_kind'),
}, (t) => [
    // At most one active job per company (see the table comment).
    uniqueIndex('uq_tenant_data_jobs_active').on(t.tenantId).where(sql`status IN ('queued', 'running')`),
    // Tenant-led paging index for the export reader (same shape as every other tenant table).
    index('idx_tenant_data_jobs_tenant_id').on(t.tenantId, t.id),
    // "A company's jobs, newest first."
    index('idx_tenant_data_jobs_tenant_created').on(t.tenantId, t.createdAt),
    // The expiry sweep reads by state and by lease expiry.
    index('idx_tenant_data_jobs_sweep').on(t.status, t.leaseExpiresAt),
    check('ck_tenant_data_jobs_cursor_len', sql`${t.cursor} IS NULL OR length(${t.cursor}) <= ${sql.raw(String(DATA_JOB_TEXT_MAX_CHARS))}`),
    check('ck_tenant_data_jobs_counts_len', sql`${t.counts} IS NULL OR length(${t.counts}) <= ${sql.raw(String(DATA_JOB_TEXT_MAX_CHARS))}`),
]);

export type TenantDataJob = typeof tenantDataJobs.$inferSelect;
export type NewTenantDataJob = typeof tenantDataJobs.$inferInsert;

/**
 * Row-level import identity map. For every row an import creates or maps, one row
 * records (package, table, source id) -> new id. It is the anchor for apply
 * idempotency (a mapped row is skipped on replay), revert (the delete list), the
 * free-tier quota exclusion (an inspection whose id is a `new_id` here is
 * imported, not a new inspection) and the read-only marker on imported records.
 * The marker is never removed: to reuse an imported report the owner copies it
 * into a NEW report, which is not in this map.
 *
 * No FK to the imported tables: the map outlives deletes and stays tenant-scoped.
 * Ids are opaque strings; the service layer, not this schema, validates their
 * shape. Every read/write is scoped by tenant_id from the verified session.
 */
export const importIdMap = sqliteTable('import_id_map', {
    id:         text('id').primaryKey(),
    tenantId:   text('tenant_id').notNull(),
    packageId:  text('package_id').notNull(),
    tableName:  text('table_name').notNull(),
    sourceId:   text('source_id').notNull(),
    newId:      text('new_id').notNull(),
    createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // One mapping per (package, table, source row) — the idempotency/replay key.
    uniqueIndex('uq_import_id_map_source').on(t.tenantId, t.packageId, t.tableName, t.sourceId),
    // Tenant-led paging index (the per-table export/scan convention).
    index('idx_import_id_map_tenant_id').on(t.tenantId, t.id),
    // Quota / read-only checks ask "which imported inspections live here" by new id.
    index('idx_import_id_map_new_id').on(t.tenantId, t.tableName, t.newId),
    // Revert lists all rows a package wrote.
    index('idx_import_id_map_package').on(t.tenantId, t.packageId),
]);

export type ImportIdMapRow = typeof importIdMap.$inferSelect;
export type NewImportIdMapRow = typeof importIdMap.$inferInsert;

/**
 * One row per imported evidence/history archive. The archive BYTES live in R2
 * under `evidence-archives/<tenantId>/<packageId>/`; this row is the ledger:
 * the package's own sha256 and counts, plus the source ids whose evidence is
 * preserved. No signing row is written to any live table — the archive is a
 * byte-identical copy verified with the same chain verifier as an evidence pack.
 * The row is never removed by revert: imported evidence stays auditable.
 */
export const importArchives = sqliteTable('import_archives', {
    id:         text('id').primaryKey(),
    tenantId:   text('tenant_id').notNull(),
    packageId:  text('package_id').notNull(),
    sha256:     text('sha256').notNull(),          // sha256 of the archived evidence bytes
    counts:     text('counts'),                    // serialized per-file counts (opaque to the DB)
    sourceIds:  text('source_ids'),                // serialized source ids whose evidence is archived
    createdAt:  integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    uniqueIndex('uq_import_archives_package').on(t.tenantId, t.packageId),
    index('idx_import_archives_tenant_id').on(t.tenantId, t.id),
]);

export type ImportArchiveRow = typeof importArchives.$inferSelect;
export type NewImportArchiveRow = typeof importArchives.$inferInsert;
