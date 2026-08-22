/**
 * A courtesy translation of a published report, keyed to the English it was
 * made from.
 *
 * English is the inspection record. A translation is a reading aid produced
 * from one particular state of that record, and it stops being one the moment
 * the record moves — a reader shown a translated finding the inspector has
 * since corrected is worse off than a reader shown no translation at all. So
 * the row carries the hash of the English it was made from, and a reader whose
 * report no longer hashes to it is served the English half only.
 *
 * ## WHAT `english_hash` PROVES, AND WHAT IT DOES NOT
 *
 * It is the value `InspectionService.getReportContentHash` returned at the
 * moment the translation was produced: a digest over the render inputs for the
 * report, plus the render version. Read the guarantee in one direction only.
 *
 *  - A MATCH proves the render inputs that produced the English half are
 *    byte-identical to the ones this translation was made from. That is what
 *    "not stale" has to mean here, and it is the direction a reader depends on.
 *  - A MISMATCH proves only that SOMETHING in those inputs moved. It does not
 *    prove this report's own prose changed: that hash is computed per
 *    INSPECTION, while this table is keyed per REPORT, and one inspection can
 *    deliver several (a standard report and a radon report). Republishing the
 *    radon report therefore withholds the standard report's translation too.
 *
 * ⚠️ The grain mismatch is not only in the hash. The whole render path is
 * inspection-grained today: `getReportData` takes no report id, and the public
 * report route has no notion of one, so a caller wanting a translation has to
 * resolve `reports.id` itself before it can look one up. Keyed per REPORT
 * anyway, matching `report_versions` and `inspection_results.report_id`,
 * because a translation is of a DOCUMENT and this is the identity that
 * survives — and because a key column, once shipped, is frozen rather than
 * re-grained later.
 *
 * That asymmetry is deliberate and it is the safe one. The rule can withhold a
 * translation that was in fact still accurate — visible, repairable, and the
 * inspector is the one who notices. It cannot do the reverse and serve one that
 * is stale, which is silent and reaches the client. Narrowing the hash to the
 * report grain would be an improvement to make in
 * `inspection-report.service.ts`, not a reason to loosen the comparison here.
 *
 * It proves nothing at all about the translation's ACCURACY. Nothing in a hash
 * can; that is what `notice_version` is for, and why the notice is not
 * dismissible.
 *
 * ## The row is also the opt-in record
 *
 * Three states fall out of one table with no extra column: no row = never
 * translated; a row whose hash matches = live; a row whose hash does not =
 * previously translated, currently withheld. A publish surface reads the third
 * to pre-tick its own box, and a deliberate untick DELETES the row, which is
 * how a person records that they no longer want one.
 */
import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

export const reportTranslations = sqliteTable('report_translations', {
    id:           text('id').primaryKey(),
    tenantId:     text('tenant_id').notNull(),
    /** `reports.id` — the deliverable, not the order. Not a foreign key. */
    reportId:     text('report_id').notNull(),
    /** BCP-47 tag of the language produced, e.g. `es-419`. */
    locale:       text('locale').notNull(),
    /**
     * The translated segments, as a JSON array of strings in the order they
     * were sent. Callers re-insert them POSITIONALLY, so the array's length is
     * part of its meaning and a shorter one is never a partial success to
     * salvage (`server/lib/ai/translate-response.ts` refuses one at the seam).
     *
     * Declared as TEXT rather than `{ mode: 'json' }` on purpose:
     * `translated_hash` below is a digest of exactly these bytes, and a column
     * that parses on read
     * and re-serialises on write would make the hash a digest of whatever the
     * serialiser did that day. Storing the string keeps the hash checkable
     * against the row.
     */
    content:      text('content').notNull(),
    /**
     * Which backend produced it and on whose credentials, as
     * `<provider id>:<credential source>` (e.g. `openai-compatible:byo`).
     * "Who translated this" is the first question asked when somebody disputes
     * a word, and the answer has to survive a settings change made afterwards.
     */
    source:       text('source').notNull(),
    /**
     * The render-input hash of the English this was made FROM. Read the header
     * of this file before relying on a match or a mismatch — the two are not
     * symmetric.
     */
    englishHash:  text('english_hash').notNull(),
    /**
     * SHA-256 of `content` as stored. Paired with `english_hash` and
     * `notice_version` so a copy of a document presented later can be matched
     * to the exact text that was shown alongside that exact notice; one of the
     * three on its own answers none of that.
     *
     * NOT called `content_hash`. `report_versions.content_hash` already exists
     * one join away and means the integrity seal over a publish snapshot — a
     * second column of that name, meaning the translated half of a different
     * document, is a name that reads as correct at every call site that gets it
     * wrong.
     */
    translatedHash: text('translated_hash').notNull(),
    /**
     * Version of the courtesy-translation notice in force when this was
     * produced (`server/lib/legal/courtesy-translation-notice.ts`). The notice
     * is versioned platform copy, so the number is what makes "which notice was
     * this shown under" answerable at all.
     */
    noticeVersion: integer('notice_version').notNull(),
    /**
     * `ai_call_provenance.id` for the call that produced these segments. The
     * model and the prompt version are reached THROUGH this id and are
     * deliberately not copied here: two homes for one fact is two numbers that
     * have to agree. Same treatment as `ai_content_reviews.ai_call_id`.
     */
    aiCallId:     text('ai_call_id').notNull(),
    generatedAt:  integer('generated_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => [
    // UNIQUE, not a plain index. One report has at most one translation per
    // language; a second row would make "the" translation ambiguous at every
    // read, and regeneration would quietly accumulate them.
    uniqueIndex('uq_report_translations_report_locale').on(t.tenantId, t.reportId, t.locale),
]);

export type ReportTranslation = typeof reportTranslations.$inferSelect;
export type NewReportTranslation = typeof reportTranslations.$inferInsert;
