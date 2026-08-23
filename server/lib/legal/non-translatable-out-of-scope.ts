/**
 * OI #58 — the non-translatable registry's out-of-scope register.
 *
 * The companion to `NON_TRANSLATABLE_MANIFEST` in
 * `non-translatable-manifest.ts`: content a reader would reasonably expect to
 * find on that list and which is deliberately NOT on it, each with the reason.
 * The two arrays are read together by `scripts/check-non-translatable.mjs` and
 * mean nothing apart — the manifest says what stays English, and this says
 * where the line was drawn and why, which is the half an audit actually reads.
 *
 * ⚠️ An entry here is not a permission slip. "Out of scope of the legal-
 * instrument rule" means the eight-category ruling does not reach it; whether
 * it may ever be machine-translated is still answered by
 * `server/lib/ai/output-classification.ts`, where `translation` is
 * `not_released` on every credential source today. Two independent answers, and
 * this file only gives one of them.
 *
 * Keep this list SHORT. It is a boundary, not a catalogue: every entry should be
 * something a careful reader would otherwise have flagged as a gap.
 */

/**
 * Content excluded from the legal-instrument rule, with the reason.
 *
 * @gateConsumed read as source text by `scripts/check-non-translatable.mjs`.
 * The gate hard-fails an entry with no reason — precedent
 * `ERASURE_OUT_OF_SCOPE`, same rule and for the same reason: an exclusion
 * without one is a shrug that reads like a decision.
 */
export interface NonTranslatableOutOfScopeEntry {
    /** Stable slug. Must not collide with a manifest entry id. */
    id: string;
    /** Repo-relative path to the file that holds or declares the content. */
    source: string;
    /** Why the eight-category ruling does not reach this. */
    reason: string;
}

/** @gateConsumed read as source text by `scripts/check-non-translatable.mjs`. */
export const NON_TRANSLATABLE_OUT_OF_SCOPE: NonTranslatableOutOfScopeEntry[] = [
    // ── The two platform notices. The boundary this register mainly exists for.
    {
        id: 'oos-report-view-disclosure',
        source: 'server/lib/legal/report-view-disclosure.ts',
        reason: 'The Art. 13 report-view notice. A platform notice ABOUT the report, not a term OF it: it tells a recipient that a view counter exists, what it deliberately does not record, and how to object. It is already rendered through the message catalogue with a live es-419 value, deliberately, and that is correct — a transparency notice does its job only if the reader can read it. Freezing it to English would weaken the lawful basis it supports, which is the opposite of what the eight-category ruling protects.',
    },
    {
        id: 'oos-agreement-language-disclosure',
        source: 'server/lib/legal/agreement-language-disclosure.ts',
        reason: 'The neutral disclosure shown alongside an agreement. It is positioned as a neutral platform disclosure: it states a fact and decides nothing, with no governs / prevails / controls language anywhere in it. It is versioned platform copy rather than a catalogue string, but for VERSION-INTEGRITY reasons — its version is signature evidence on agreement_signers.language_disclosure_version — and not because the eight-category ruling reaches it. Recorded here so the two justifications are never merged into one.',
    },

    {
        id: 'oos-courtesy-translation-notice',
        source: 'server/lib/legal/courtesy-translation-notice.ts',
        reason: 'The notice that travels with a courtesy translation. A platform notice ABOUT the translated document, not a term OF the inspection agreement: it states which document is the inspection record and what the reader is holding, and it says nothing about who governs, prevails or controls. It is a versioned constant for the same VERSION-INTEGRITY reason as the agreement-language disclosure — every stored translation records the version in force when it was produced — and not because the eight-category rule reaches it. ⚠️ The English wording is fixed, but a rendering of it in the reader language is expected and correct: a notice explaining that a translation is unofficial is worth nothing to the only reader who needs it if it arrives in the language they could not read. What it must never do is pass through the machine translation it is describing.',
    },

    // ── The content #23 exists to translate. Listing it is the point: the
    // registry must not read as though everything in the report is frozen.
    {
        id: 'oos-inspection-results-findings',
        source: 'server/lib/db/schema/inspection/core.ts',
        reason: 'The findings themselves — the inspector observations, ratings and notes stored on inspection_results.data. This is the observational content report courtesy translation (#23) exists for. It describes a property; it allocates nothing between the parties, and no one signs it.',
    },
    {
        id: 'oos-canned-comment-library',
        source: 'server/lib/db/schema/inspection/comments.ts',
        reason: 'The canned-comment library. Reusable observation and recommendation text an inspector drops into a finding. Same character as the findings it becomes part of, and out of scope for the same reason.',
    },

    // ── Product chrome. Out of scope, and the gate needs it said out loud
    // because the surfaces that RENDER instrument text are themselves
    // translated, which is easy to mistake for the text being translated.
    {
        id: 'oos-ui-message-catalogue',
        source: 'messages/en/reports.json',
        reason: 'Interface copy — labels, buttons, section headings, help text. The agreement signing page and the report view are fully translated product chrome that happens to display untranslated instrument text inside them. Translating the frame is not translating the document, and stopping the frame at English would make the document harder to reach without making it safer.',
    },
];
