import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * Commercial PCA Phase W — async `.docx` export status row. One row per
 * export request (`create` inserts `queued`); the queue consumer flips it
 * through `building` -> `ready` (with the R2 key + size) or `failed` (with
 * an error message). No `.references()` FK (D1 cannot rebuild FK-referenced
 * tables); tenant isolation is enforced at the service layer via tenant-
 * scoped queries. See #186.
 */
export const reportExports = sqliteTable('report_exports', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull(),
    inspectionId:  text('inspection_id').notNull(),
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
