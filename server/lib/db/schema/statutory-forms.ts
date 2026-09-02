import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

/**
 * Published revisions of statutory inspection forms — APPEND-ONLY.
 *
 * A statutory form is an authority's own PDF, not a template of ours. This
 * table records what an operator PUBLISHED into this deployment: which revision
 * of which form, the dates it applies to, where its bytes came from, and the
 * hash of the exact bytes they published. The bytes themselves live in object
 * storage under `object_key`; they are not in this repository and not in this
 * table.
 *
 * ⚠️ THIS TABLE IS NOT WHAT RENDERING READS, and a reader who assumes it is
 * will draw the wrong conclusion from an empty one. `produce.service.ts` takes
 * the revision and its field map from `PUBLISHED_FORM_VERSIONS` in code, and
 * `validateAgainstPdf` compares the bytes against `map.sourceHash` — also in
 * code. Verified 2026-08-31 against production, where this table held ZERO rows
 * while the four published revisions were fully renderable: the source PDFs
 * were in object storage and each hashed to its map's `sourceHash`.
 *
 * So an empty table does not mean nothing is published; it means nothing has
 * been recorded HERE. Publishing a revision is a person's decision that needs a
 * field map authored against those exact bytes, and a row is data that can
 * arrive without one — which is why the code catalogue leads and this follows.
 * What this table is for is the operator's record of what was published into
 * THIS deployment and when it applies, which is a different question from what
 * the renderer will accept.
 *
 * ── Nothing deletes a row, and that is the point ────────────────────────────
 * A completed statutory form stays valid for years, and a report may be
 * re-rendered long after the revision it was produced against was superseded.
 * A deleted version is therefore a report that can no longer be reproduced. A
 * revision that is no longer usable is expressed by `effective_until`, never by
 * removing the row. There is no delete path anywhere in this subsystem.
 *
 * ⚠️ AN AUTHORITY SAYING A COMPLETED FORM STAYS VALID FOR UP TO FIVE YEARS IS
 * TALKING ABOUT THE COMPLETED DOCUMENT, not about how long software may keep
 * producing that revision. It is not a distribution licence, and reading it as
 * one is exactly how a withdrawn revision stays on offer. Whether we may keep
 * offering a revision is `effective_until`; how long a filled-in form remains
 * good is the authority's business and is not modelled here at all.
 *
 * ── Not tenant-scoped, on purpose ───────────────────────────────────────────
 * A statutory form is supplied by the platform operator and is read-only to
 * every tenant: nobody imports one, creates one, or edits one. There is no
 * `tenant_id` because there is no per-tenant version of a state's document.
 *
 * ── What is NOT here: the field map ─────────────────────────────────────────
 * How our fields land on that PDF is a hand-authored map bound to one
 * `source_hash` (`server/lib/statutory/field-map.ts`). It is not a column
 * because it may never be inherited across revisions and must be reviewable as
 * code: field names in these PDFs are hand-typed by their producers and a later
 * revision "fixing" a typo moves content into the wrong box without raising
 * anything.
 *
 * No `.references()` per Schema Rules — D1 cannot rebuild a table an FK points
 * at, so `published_by` is a soft reference to `users.id`.
 */
export const statutoryFormVersions = sqliteTable('statutory_form_versions', {
    id: text('id').primaryKey(),
    /**
     * The FORM, never one of its revisions — e.g. `tx_trec_rei`. An id carrying
     * a revision number cannot express two revisions of the same form being
     * usable at once, which is what a voluntary-use window is.
     */
    formId: text('form_id').notNull(),
    /** The authority's own revision label, verbatim: `7-6`, `Rev. 04/26`. */
    version: text('version').notNull(),
    /** First date this revision may be used. */
    effectiveFrom: integer('effective_from', { mode: 'timestamp_ms' }).notNull(),
    /**
     * First date this revision is REQUIRED, or NULL for one that was published
     * and never mandated. NULL keeps the revision selectable and keeps it out of
     * the default: adopting a not-yet-mandatory revision is the inspector's
     * decision, not the registry's.
     */
    mandatoryFrom: integer('mandatory_from', { mode: 'timestamp_ms' }),
    /**
     * First date this revision may NO LONGER be used — exclusive. NULL means
     * still usable; it does NOT mean "the latest revision", because an authority
     * may run two revisions in overlap.
     */
    effectiveUntil: integer('effective_until', { mode: 'timestamp_ms' }),
    /** Where the authority publishes it. Provenance for a human; never fetched at render time. */
    sourceUrl: text('source_url').notNull(),
    /**
     * sha256 (lowercase hex) of the exact bytes published. This is the join
     * between a row, the stored object, and the field map authored against it —
     * a map whose hash does not match these bytes is refused rather than used.
     */
    sourceHash: text('source_hash').notNull(),
    /** Object-storage key holding those exact bytes. Never a path in this repository. */
    objectKey: text('object_key').notNull(),
    /** users.id of the operator who published it. Soft reference. */
    publishedBy: text('published_by').notNull(),
    publishedAt: integer('published_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // One row per (form, revision). Publishing the same revision twice is a
    // mistake worth failing on: two rows with different hashes would leave
    // "which bytes is this revision" unanswerable.
    uniqueIndex('uq_statutory_form_versions_form_version').on(t.formId, t.version),
    // The read path: every revision of one form, filtered by date in memory.
    // The set per form is single digits, so the date bounds are not indexed.
    index('idx_statutory_form_versions_form').on(t.formId, t.effectiveFrom),
]);

export type StatutoryFormVersionRow = typeof statutoryFormVersions.$inferSelect;
export type NewStatutoryFormVersionRow = typeof statutoryFormVersions.$inferInsert;
