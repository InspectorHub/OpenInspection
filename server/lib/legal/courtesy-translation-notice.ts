/**
 * The notice that travels with every courtesy translation of a report.
 *
 * A translation of an inspection report is a reading aid. The document of
 * record is the English one, and a reader holding only the translated half has
 * no way to know that unless the document says so — so the notice is part of
 * the feature rather than an addition to it. A translated report shipped
 * without it is the exact confusion the whole design exists to avoid.
 *
 * ## What this sentence deliberately does NOT do
 *
 * It states which document IS the record. It does not say that one text
 * "governs", "prevails" or "controls" over another. That distinction is the
 * whole reason the wording is fixed here rather than phrased by whoever renders
 * it: a governing-language provision allocates risk between an inspector and
 * their client, and this platform is not a party to that allocation — it
 * carries the document and authors none of its terms. The same line is drawn,
 * for the same reason, in `agreement-language-disclosure.ts`.
 *
 * It also makes no claim about the translation's accuracy, in either direction.
 * It says what the reader is holding.
 *
 * ## Why a versioned constant, and what the version is FOR
 *
 * This is reviewed platform legal copy: changing it is a deliberate act with a
 * version bump, not a string edited in passing inside a component. The version
 * is the load-bearing part. Every stored translation records the version in
 * force when it was produced (`report_translations.notice_version`), so a
 * client presenting a copy of a document months later can be matched to the
 * notice that was actually shown with it. Reword the text without bumping
 * `version` and every one of those records starts naming the wrong sentence.
 *
 * ⚠️ Superseded wording is not archived anywhere. A bump replaces the string,
 * so a surface asked to reproduce an OLD version has only two honest options:
 * print nothing, or say which version it was and that the text is not retained.
 * Printing the current sentence as though it were the old one is a claim the
 * record cannot support. `signaturesRecordCurrentDisclosure` in
 * `agreement-language-disclosure.ts` is the same rule, already written down.
 *
 * ## Rendering
 *
 * Non-dismissible, above translated content, on every surface that shows any.
 * A notice a reader can close once and never see again is the state this exists
 * to prevent.
 *
 * A rendering of this sentence in the READER'S language is a separate decision
 * from the text below and is not made here. This module holds the English
 * wording and the version; which text a reader is actually shown is answered by
 * `courtesyTranslationNoticeFor` at the bottom of this file, which consults the
 * register of REVIEWED per-language constants.
 *
 * ⚠️ Not the message catalogue, and the reason is the sentence itself. This is
 * the text that DEFINES WHICH DOCUMENT CARRIES AUTHORITY, so it must never pass
 * through the machine translation it is describing — and it must not be an
 * ordinary catalogue string either, because a bulk translation pass could then
 * reword it with nobody deciding anything. A target-language wording becomes
 * authoritative only once a qualified legal translator has reviewed it. That
 * register is empty today, so every reader is shown the English, which is the
 * record itself.
 */

import {
    resolveReviewedConstant,
    type ResolvedConstantText,
} from './reviewed-language-constants';

/**
 * Version of the notice copy. Bump on ANY wording change.
 *
 * Recorded on every translation row, so this number is evidence rather than
 * bookkeeping — see the header.
 */
const COURTESY_TRANSLATION_NOTICE_VERSION = 1;

export const COURTESY_TRANSLATION_NOTICE = Object.freeze({
    version: COURTESY_TRANSLATION_NOTICE_VERSION,
    /**
     * The document's own identity, carried on the first page of a translated
     * deliverable. Phrased as what the document IS, not as a disclaimer about
     * it: a reader skims a title and does not read a caveat.
     */
    title: 'Courtesy Translation of Inspection Report',
    /**
     * The notice, verbatim. Two sentences: which document is the record, and
     * what this one is for.
     */
    text: 'The English version is the official inspection record. '
        + 'This courtesy translation is provided to assist understanding '
        + 'and may not reflect the exact wording of the English report.',
});

/**
 * The notice as one reader should see it, and whether that text IS the record.
 *
 * Today this always answers with the English wording and `authoritative: true`,
 * because no language has been reviewed. That is not a stub: it is the correct
 * answer, and it becomes a different answer the day a reviewed constant is
 * registered — without this function or its callers changing.
 *
 * ⚠️ The English string and `version` above are NOT touched by any of this.
 * Every stored translation records the version in force when it was produced,
 * so a bump orphans every one of those records.
 */
export function courtesyTranslationNoticeFor(locale: string): ResolvedConstantText {
    return resolveReviewedConstant('courtesy_translation_notice', locale, {
        version: COURTESY_TRANSLATION_NOTICE.version,
        title: COURTESY_TRANSLATION_NOTICE.title,
        text: COURTESY_TRANSLATION_NOTICE.text,
    });
}
