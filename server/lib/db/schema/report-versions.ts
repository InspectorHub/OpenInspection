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
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

export const reportVersions = sqliteTable('report_versions', {
    id:             text('id').primaryKey(),
    tenantId:       text('tenant_id').notNull(),
    inspectionId:   text('inspection_id').notNull(),
    versionNumber:  integer('version_number').notNull(),
    snapshotJson:   text('snapshot_json').notNull(),
    // NOT a summary of the report. It is the per-publish AMENDMENT REASON: the
    // free-text "what changed" note (max 500 chars) the publish request carries,
    // NULL on a first publish. Surfaced as `reason` in the report page's
    // amendment trail and as {{summary}} in the report.amended email.
    summary:        text('summary'),
    // #120 — integrity layer. content_hash = SHA-256(snapshot_json); prev_hash
    // chains to the previous version's content_hash; signature = Ed25519 over
    // content_hash by the tenant signing key (reused from e-sign). is_amendment
    // is true for v>=2. verification_token keys the public verifier. All nullable
    // so pre-#120 rows load (verifier shows a "predates verification" notice).
    contentHash:       text('content_hash'),
    prevHash:          text('prev_hash'),
    // Verified against the key named by THIS row's key_fingerprint, resolved
    // from the tenant's key history — so a rotation leaves earlier versions
    // verifying exactly as before. Reading the tenant's current key instead is
    // the bug this replaced: it reported every pre-rotation version as
    // `signatureValid: false` on a public page.
    signature:         text('signature'),
    // SHA-256 of the public key that signed this row. This is what selects the
    // key at verification time, so it is load-bearing rather than decorative;
    // it is also published on the verifier page, where a reader can tell whether
    // two reports were signed by the same key. NULL only on pre-#120 rows, which
    // carry no signature to check.
    keyFingerprint:    text('key_fingerprint'),
    isAmendment:       integer('is_amendment', { mode: 'boolean' }).notNull().default(false),
    // The bearer credential for the public verifier: a random UUID minted per
    // publish and the SOLE lookup key for the /v/:token page and the frozen-PDF
    // endpoint (both unauthenticated). Never reused across versions.
    verificationToken: text('verification_token'),
    publishedAt:    integer('published_at', { mode: 'timestamp_ms' }).notNull(),
    // users.id of the publisher, straight from the JWT and never resolved to a
    // name. A publish with no authenticated user writes no version row at all,
    // so this is never a placeholder. Returned by the versions list endpoint;
    // no surface currently renders it.
    publishedBy:    text('published_by').notNull(),
    createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch() * 1000)`),
    // The report this version belongs to. Two reports on one order publish
    // independently and each needs its OWN v1 and its own prev_hash chain —
    // interleaving them into one chain fails verification for both, including
    // for versions published before the second report existed.
    // Appended at table end for D1 rebuild safety.
    reportId:       text('report_id'),
}, (t) => [
    // Version numbers are monotonic per REPORT, not per inspection. This index
    // is also the read path (`ORDER BY version_number` within one report) — a
    // second, non-unique index on exactly these two columns used to sit beside
    // it, duplicating both the lookup and the write cost.
    uniqueIndex('uq_report_versions_report_version').on(t.reportId, t.versionNumber),
    uniqueIndex('idx_report_versions_verify_token').on(t.verificationToken),
]);
