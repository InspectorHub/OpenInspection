/**
 * Storage for courtesy translations, and the one rule that decides whether a
 * stored one may be shown.
 *
 * The rule is a comparison of two hashes and it is stated in the schema
 * (`server/lib/db/schema/report-translation.ts`) rather than here, because it
 * is a property of the column and not of this class. Read it before changing
 * either method below: the match and the mismatch do not prove symmetric
 * things, and the asymmetry is what makes withholding safe.
 *
 * WHY TWO READS. `read` returns the record whatever its hash; `readFresh`
 * returns it only when the report it is read against still hashes to the
 * English it was made from. Client-facing surfaces call the second. The first
 * exists because "no translation" and "a translation, currently withheld" are
 * different answers to the person who can repair the second one, and a single
 * method returning null for both would erase that distinction at every call
 * site at once.
 *
 * ⚠️ Nothing here reads a tenant setting, and that is an invariant rather than
 * an omission. Turning the feature off must not alter a single already
 * published report: the reader path answers from stored rows only, so a
 * settings change can stop new translations being produced and can never strip
 * one from a document already delivered.
 */
import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { reportTranslations } from '../lib/db/schema';
import { COURTESY_TRANSLATION_NOTICE } from '../lib/legal/courtesy-translation-notice';
import { sha256Hex } from './signing-key.service';

/** What a caller has in hand once a provider has answered. */
export interface CourtesyTranslationInput {
    /**
     * The translated segments, positionally aligned with the English segments
     * that were sent. Length is part of the meaning — see
     * `server/lib/ai/translate-response.ts`, which refuses a mismatched length
     * at the provider seam so a wrong-length array never reaches this method.
     */
    segments: string[];
    /** `<provider id>:<credential source>`, e.g. `openai-compatible:byo`. */
    source: string;
    /**
     * The render-input hash of the English these segments were produced from,
     * taken from `InspectionService.getReportContentHash` at production time.
     * Passed IN rather than recomputed here: recomputing it would hash a report
     * that may have moved in between, and the row would then claim a provenance
     * the translation does not have.
     */
    englishHash: string;
    /** `ai_call_provenance.id` for the call that produced the segments. */
    aiCallId: string;
}

/** A stored translation, with `content` already parsed back into segments. */
export interface StoredCourtesyTranslation {
    id: string;
    locale: string;
    segments: string[];
    source: string;
    englishHash: string;
    translatedHash: string;
    noticeVersion: number;
    aiCallId: string;
    generatedAt: Date;
}

export class ReportTranslationService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Record a translation for one report and one language, replacing whatever
     * was there.
     *
     * REPLACE, not append. A report has at most one translation per language;
     * the unique index says so and this method is what makes regeneration mean
     * "the previous one is gone" rather than "there are now two and the reader
     * gets whichever the query returned first".
     */
    async store(
        tenantId: string,
        reportId: string,
        locale: string,
        input: CourtesyTranslationInput,
    ): Promise<StoredCourtesyTranslation> {
        const db = this.getDrizzle();

        // The stored bytes are produced ONCE and both hashed and written. A
        // second `JSON.stringify` for the hash would be a second answer to what
        // is in the column.
        const content = JSON.stringify(input.segments);
        const translatedHash = await sha256Hex(content);
        const row = {
            id: crypto.randomUUID(),
            tenantId,
            reportId,
            locale,
            content,
            source: input.source,
            englishHash: input.englishHash,
            translatedHash,
            noticeVersion: COURTESY_TRANSLATION_NOTICE.version,
            aiCallId: input.aiCallId,
            generatedAt: new Date(),
        };

        // Delete-then-insert rather than an upsert on the unique index: the new
        // row is a different translation with its own id, its own provenance
        // row and its own notice version, and carrying the old id forward would
        // make the record of the previous one unreachable while still looking
        // like it was never replaced.
        await db.delete(reportTranslations).where(and(
            eq(reportTranslations.tenantId, tenantId),
            eq(reportTranslations.reportId, reportId),
            eq(reportTranslations.locale, locale),
        )).run();
        await db.insert(reportTranslations).values(row).run();

        return { ...row, segments: input.segments };
    }

    /**
     * The record for one report and one language, whatever English it was made
     * from. Never rendered to a client — see the class header for which of the
     * two reads is the client-facing one.
     */
    async read(
        tenantId: string,
        reportId: string,
        locale: string,
    ): Promise<StoredCourtesyTranslation | null> {
        const row = await this.getDrizzle()
            .select()
            .from(reportTranslations)
            .where(and(
                eq(reportTranslations.tenantId, tenantId),
                eq(reportTranslations.reportId, reportId),
                eq(reportTranslations.locale, locale),
            ))
            .get();
        return row ? hydrate(row) : null;
    }

    /**
     * The translation to SHOW, or null.
     *
     * Null means "show the English only". It covers both "there is none" and
     * "there is one and it does not describe this document any more", because a
     * reader has nothing to do with the difference — the distinction belongs to
     * `read` and to whoever can fix it.
     *
     * @param currentEnglishHash `getReportContentHash` for the report as it
     *        stands right now. A caller that passes a hash from anywhere else is
     *        answering a different question than this method's contract states.
     */
    async readFresh(
        tenantId: string,
        reportId: string,
        locale: string,
        currentEnglishHash: string,
    ): Promise<StoredCourtesyTranslation | null> {
        const stored = await this.read(tenantId, reportId, locale);
        if (!stored) return null;
        // WITHHELD, not flagged. A translation shown with a warning is still a
        // translation of a document that no longer exists, and the reader who
        // most needs the warning is the one least able to act on it.
        if (stored.englishHash !== currentEnglishHash) return null;
        return stored;
    }

    /**
     * Take a translation down. Returns whether a row was actually removed, so a
     * caller can tell "removed" from "there was nothing to remove" — the second
     * is not an error and must not be reported as success at doing something.
     *
     * Removal stays available even where production is switched off: cleaning
     * up after turning the feature off is exactly when it is needed.
     */
    async remove(tenantId: string, reportId: string, locale: string): Promise<boolean> {
        // RETURNING rather than a driver rowcount, because `meta.changes` is the
        // D1 shape and better-sqlite3 answers `changes` — a difference this
        // repository already absorbs in `lib/compliance/db-row-utils.ts`. The
        // reason to prefer RETURNING anyway is that it needs no such helper:
        // what came back IS the answer, on either driver.
        //
        // (The unit harness does supply `meta.changes`, so a rowcount here
        // would have been observable. It is still the weaker option.)
        const removed = await this.getDrizzle()
            .delete(reportTranslations)
            .where(and(
                eq(reportTranslations.tenantId, tenantId),
                eq(reportTranslations.reportId, reportId),
                eq(reportTranslations.locale, locale),
            ))
            .returning({ id: reportTranslations.id });
        return removed.length > 0;
    }
}

/**
 * Row -> domain. The parse is narrow on purpose: `content` is written by
 * `store` above and by nothing else, so the only shape it can hold is the array
 * that method serialised. A tolerant reader here would be inventing a recovery
 * path for a corruption that has no writer.
 */
function hydrate(row: typeof reportTranslations.$inferSelect): StoredCourtesyTranslation {
    return {
        id: row.id,
        locale: row.locale,
        segments: JSON.parse(row.content) as string[],
        source: row.source,
        englishHash: row.englishHash,
        translatedHash: row.translatedHash,
        noticeVersion: row.noticeVersion,
        aiCallId: row.aiCallId,
        generatedAt: row.generatedAt,
    };
}
