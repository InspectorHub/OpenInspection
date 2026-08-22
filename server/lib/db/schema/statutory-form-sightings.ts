import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { SIGHTING_VERDICTS } from '../../statutory/revision-watch';

/**
 * What the scheduled watcher SAW on an authority's page. Not a form we offer.
 *
 * ── This table is the "detected" half of detect-but-never-adopt ─────────────
 * `statutory_form_versions` is what a person decided this deployment publishes.
 * This one is what a fetch found. Keeping them apart is not tidiness: a watcher
 * that only reports costs nothing on the day it misses a revision, while one
 * that replaces sends an inspector a statutory form the state did not ask for,
 * which they then file. Nothing writes both tables in one code path, and the
 * columns below make the separation structural rather than a convention —
 * there is no `effective_from`, no `mandatory_from`, no `published_by` and no
 * `object_key` here, because a fetch establishes none of those. They are what a
 * publication decision supplies, and `isPublishedVersion` in
 * `server/lib/statutory/form-registry.ts` refuses a version row without them.
 *
 * ── One row per distinct thing seen, not per poll ───────────────────────────
 * A daily poll of an unchanged page would otherwise write a row a day forever.
 * The unique index is (form, page, digest): the first sighting of some bytes
 * inserts, every later sighting of the SAME bytes moves `last_seen_at`. So the
 * row count is bounded by the number of distinct revisions an authority has
 * ever served us, which is single digits over the life of a form, and the pair
 * of timestamps answers the question a person actually asks — since when has
 * this page been serving something we do not publish.
 *
 * ── Retention: nothing sweeps it, and that is a declaration ─────────────────
 * `lint:retention`'s name pattern does not reach `*_sightings`, so this table
 * could ship with the gate green and no decision recorded anywhere. The
 * decision is: not swept. It holds an agency's URL, a digest and two dates — no
 * subject data at all, so there is no clock to attach — and it is bounded by
 * revisions rather than by usage. A companion entry in
 * `server/lib/compliance/retention-manifest.ts` is owed and is NOT made by this
 * change, which does not own that file; this paragraph is here so the absence
 * is visible in the place a reader would look for it.
 *
 * ── Not tenant-scoped, for the same reason as the versions table ────────────
 * A statutory form is supplied by the platform operator and is read-only to
 * every tenant. There is no per-tenant version of a state's document, so there
 * is nothing per-tenant to observe about one either.
 *
 * No `.references()` per Schema Rules: D1 cannot rebuild a table an FK points
 * at. `form_id` is a soft reference to `statutory_form_versions.form_id`, and
 * deliberately soft in a second sense — a sighting for a form we publish no
 * revision of is recorded with the `unrecognised` verdict rather than refused.
 */
export const statutoryFormSightings = sqliteTable('statutory_form_sightings', {
    id: text('id').primaryKey(),
    /** The form we were looking for — never a revision of it. Soft reference. */
    formId: text('form_id').notNull(),
    /** The authority page that was polled, verbatim from the published revision. */
    sourceUrl: text('source_url').notNull(),
    /** sha256 (lowercase hex) of the bytes that page served. */
    observedHash: text('observed_hash').notNull(),
    /**
     * How that digest compared with every revision of this form we publish.
     * `unrecognised` is its own answer rather than a flavour of `changed`: with
     * nothing published on our side there is nothing to compare against, and an
     * alarm raised out of that would be one we invented.
     */
    verdict: text('verdict', { enum: SIGHTING_VERDICTS }).notNull(),
    firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
    lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // What makes a poll idempotent. Without it a daily check of a page nobody
    // changed would grow this table forever and bury the one row that matters.
    uniqueIndex('uq_statutory_form_sightings_seen')
        .on(t.formId, t.sourceUrl, t.observedHash),
    // The read a person wants: what has this form's page been serving lately.
    index('idx_statutory_form_sightings_form').on(t.formId, t.lastSeenAt),
]);

export type StatutoryFormSightingRow = typeof statutoryFormSightings.$inferSelect;
export type NewStatutoryFormSightingRow = typeof statutoryFormSightings.$inferInsert;
