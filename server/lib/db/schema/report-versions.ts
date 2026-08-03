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
import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const reportVersions = sqliteTable('report_versions', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    inspectionId:   text('inspection_id').notNull(),
    versionNumber:  integer('version_number').notNull(),
    snapshotJson:   text('snapshot_json').notNull(),
    summary:        text('summary'),
    // #120 — integrity layer. content_hash = SHA-256(snapshot_json); prev_hash
    // chains to the previous version's content_hash; signature = Ed25519 over
    // content_hash by the tenant signing key (reused from e-sign). is_amendment
    // is true for v>=2. verification_token keys the public verifier. All nullable
    // so pre-#120 rows load (verifier shows a "predates verification" notice).
    contentHash:       text('content_hash'),
    prevHash:          text('prev_hash'),
    signature:         text('signature'),
    keyFingerprint:    text('key_fingerprint'),
    isAmendment:       integer('is_amendment', { mode: 'boolean' }).notNull().default(false),
    verificationToken: text('verification_token'),
    publishedAt:    integer('published_at', { mode: 'timestamp_ms' }).notNull(),
    publishedBy:    text('published_by').notNull(),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
    // The report this version belongs to. Two reports on one order publish
    // independently and each needs its OWN v1 and its own prev_hash chain —
    // interleaving them into one chain fails verification for both, including
    // for versions published before the second report existed.
    // Appended at table end for D1 rebuild safety.
    reportId:       text('report_id'),
}, (t) => [
    index('idx_report_versions_report').on(t.reportId, t.versionNumber),
    // Version numbers are monotonic per REPORT, not per inspection.
    uniqueIndex('uq_report_versions_report_version').on(t.reportId, t.versionNumber),
    uniqueIndex('idx_report_versions_verify_token').on(t.verificationToken),
]);
