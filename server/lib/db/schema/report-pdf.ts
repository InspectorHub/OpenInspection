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
    sizeBytes:     integer('size_bytes'),
    status:        text('status', { enum: ['queued', 'rendering', 'ready', 'failed'] }).notNull().default('ready'),
    error:         text('error'),
}, (t) => ({
    uqInspectionType: uniqueIndex('uq_report_pdfs_inspection_type').on(t.inspectionId, t.type),
    idxTenant:        index('idx_report_pdfs_tenant').on(t.tenantId),
    idxStatus:        index('idx_report_pdfs_status').on(t.status),
}));

export type ReportPdf = typeof reportPdfs.$inferSelect;
export type NewReportPdf = typeof reportPdfs.$inferInsert;
