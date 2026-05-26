/**
 * Design System 0520 subsystem D phase 7 — ReportVersions snapshot.
 *
 * One row per publish event. `snapshot_json` is the full inspection state
 * (inspections row + inspection_results.data + inspection_units) at the
 * moment of publish — ≤ 1 MB enforced by the service layer. Diff page
 * walks two snapshots field-by-field; the production state is unaffected.
 *
 * version_number is monotonic per inspection (UNIQUE constraint). The
 * service computes the next via SELECT MAX(version_number) + 1.
 */
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core';

export const reportVersions = sqliteTable('report_versions', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    inspectionId:   text('inspection_id').notNull(),
    versionNumber:  integer('version_number').notNull(),
    snapshotJson:   text('snapshot_json').notNull(),
    summary:        text('summary'),
    publishedAt:    integer('published_at').notNull(),
    publishedBy:    text('published_by').notNull(),
    createdAt:      text('created_at').notNull(),
});
