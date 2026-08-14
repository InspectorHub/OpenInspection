import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * The WORD (`.docx`) export — one row per press of "Export to Word" on the
 * published report. Commercial PCA Phase W; see #186.
 *
 * `create` inserts `queued`; the queue consumer flips it through `building` ->
 * `ready` (with the R2 key + size) or `failed` (with an error message). No
 * `.references()` FK (D1 cannot rebuild FK-referenced tables); tenant isolation
 * is enforced at the service layer via tenant-scoped queries.
 *
 * ⚠️ NOT `report_pdfs`, which it resembles closely enough to be worth saying
 * why. Both put a rendered file in R2 and hand back a key, so both carry
 * id / tenant / inspection / status / r2_key / size_bytes / error — that is the
 * shape of any async artifact job. They differ in LIFETIME, and every column
 * they do not share follows from it:
 *
 *   this table   a one-shot JOB TICKET. Somebody pressed a button, the queue
 *                built a file, they downloaded it, and nothing asks again. No
 *                version, no dedup, no uniqueness. `format` has exactly one
 *                member — the table is Word-only, and the enum is where that
 *                is enforced rather than in the (generic) table name.
 *
 *   report_pdfs  a durable ARCHIVE keyed to a published version. Unique on
 *                (inspection, type, version_number), with `content_hash` so an
 *                identical re-render is skipped and `source_version` so a stale
 *                one is detectable. The public verifier reads it years later.
 *
 * Which is why the two are not one table with a `kind` column: the archive's
 * NOT NULL `r2_key` and NOT NULL `source_version` cannot hold on rows that are
 * job tickets, so merging would buy one fewer table by giving up two
 * constraints.
 */
export const reportExports = sqliteTable('report_exports', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    inspectionId:  text('inspection_id').notNull(),
    // Never accepted from a request and never read back: the enqueue route
    // passes the one literal, and no query filters on it. This enum (with the
    // service's ReportExportFormat) is the whole enforcement that the table is
    // Word-only — the generic name promises a breadth that does not exist.
    format:        text('format', { enum: ['docx'] }).notNull(),
    status:        text('status', { enum: ['queued', 'building', 'ready', 'failed'] }).notNull(),
    r2Key:         text('r2_key'),
    sizeBytes:     integer('size_bytes'),
    error:         text('error'),
    createdAt:     integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    updatedAt:     integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    index('idx_report_exports_inspection').on(t.tenantId, t.inspectionId),
]);

export type ReportExport = typeof reportExports.$inferSelect;
export type NewReportExport = typeof reportExports.$inferInsert;
