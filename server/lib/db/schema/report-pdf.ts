import { sqliteTable, text, integer, uniqueIndex, index } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenant';

/**
 * Pre-rendered Summary + Full Report PDFs per inspection.
 * Spec 5A — Report PDF Pipeline. Renderer reuses server/lib/pdf.ts:generatePdfFromUrl;
 * this table tracks R2 storage metadata + render lifecycle (queued / rendering /
 * ready / failed) + source_version for stale detection vs inspection.updatedAt.
 */
export const reportPdfs = sqliteTable('report_pdfs', {
    id:            text('id').primaryKey(),
    tenantId:      text('tenant_id').notNull().references(() => tenants.id),
    inspectionId:  text('inspection_id').notNull(),
    type:          text('type', { enum: ['summary', 'full'] }).notNull(),
    r2Key:         text('r2_key').notNull(),
    renderedAt:    integer('rendered_at').notNull(),
    sourceVersion: integer('source_version').notNull(),                                              // inspection.updatedAt timestamp at render time
    // #120 — the report_versions.version_number this PDF renders. Nullable for
    // pre-#120 rows; new publishes always set it. The archive is immutable per
    // version; the "current" PDF is the highest version_number row.
    versionNumber: integer('version_number'),
    sizeBytes:     integer('size_bytes'),
    status:        text('status', { enum: ['queued', 'rendering', 'ready', 'failed'] }).notNull().default('ready'),
    error:         text('error'),
    // Content-hash cache key (SHA-256 of render inputs + RENDER_VERSION salt).
    // Null for rows rendered before this feature; populated for all new renders.
    // Identical-content re-renders are skipped: same hash = same PDF.
    contentHash:   text('content_hash'),
}, (t) => ({
    uqInspectionType: uniqueIndex('uq_report_pdfs_inspection_type').on(t.inspectionId, t.type, t.versionNumber),
    idxTenant:        index('idx_report_pdfs_tenant').on(t.tenantId),
    idxStatus:        index('idx_report_pdfs_status').on(t.status),
    idxContentHash:   index('idx_report_pdfs_content_hash').on(t.inspectionId, t.type, t.contentHash),
}));

export type ReportPdf = typeof reportPdfs.$inferSelect;
export type NewReportPdf = typeof reportPdfs.$inferInsert;
