/**
 * #23 — the register of REVIEWED per-language constants, and the one accessor
 * that decides which text a reader is shown.
 *
 * ## The problem this solves, stated once
 *
 * Some platform copy is a versioned legal constant: the notice that says which
 * document is the inspection record, and the transparency notice that makes the
 * report-view counter lawful. Both are FIXED in English on purpose — changing
 * one is a deliberate act with a version bump, not a string edited in passing.
 *
 * That gives two bad options and no good one, unless something like this
 * exists:
 *
 *  - **Freeze them to English.** A notice explaining that a translation is
 *    unofficial is worth nothing to the one reader who needs it if it arrives
 *    in the language they could not read.
 *  - **Put them in the message catalogue.** Then the sentence that says "this
 *    translation is unofficial" is itself produced by an ordinary translation
 *    pass — the machinery it is describing — and a bulk pass can reword it with
 *    nobody deciding anything.
 *
 * So there is a third disposition. A target-language wording becomes
 * AUTHORITATIVE for one constant in one language when, and only when, a
 * qualified legal translator has reviewed that text. Until then the English
 * stands and the reader is shown the record itself.
 *
 * ## The key is (constant id, locale, version). All three.
 *
 * Promotion is per TEXT and per LANGUAGE, not per language alone: reviewing the
 * courtesy notice in `es-419` says nothing about the transparency notice in
 * `es-419`, and nothing at all about `pt-BR`.
 *
 * The version is the third part and the least obvious. It is the version of the
 * ENGLISH constant the review was made against. A reviewed rendering of
 * superseded wording is worse than no rendering: it is an unreviewed sentence
 * wearing a reviewer's name. So a mismatch in EITHER direction is refused and
 * the English is served instead — reword-without-bump is exactly the failure
 * the version numbers exist to make detectable.
 *
 * ## Empty at launch, and the emptiness is asserted
 *
 * Nothing is promoted. `tests/unit/legal/reviewed-language-constants.spec.ts`
 * asserts the array is empty, so "no language has been reviewed yet" is a
 * recorded state rather than an absence — and a promotion has to walk past a
 * red test, which is the point.
 *
 * ⚠️ The pressure to promote will come from exactly the population least able
 * to check the result. A reader who cannot read the English half relies on the
 * translated one completely, which RAISES the accuracy requirement rather than
 * lowering it. "The client only reads Spanish" is an argument for more care,
 * never for less, and a promotion made on that basis rather than on a
 * translator's review is the failure this disposition exists to make visible.
 *
 * WHO may review, and to what standard, is deliberately not defined here. That
 * is a question for whoever procures the review; this module defines the
 * mechanism and records the answer.
 */

/**
 * The constants that can be promoted.
 *
 * A closed set. Both members are notices whose wording defines how a reader
 * should understand the document they are holding, which is what puts them in
 * this disposition rather than in the message catalogue.
 *
 * ⚠️ `agreement-language-disclosure.ts` is deliberately NOT here. Its version
 * is signature evidence — `agreement_signers.language_disclosure_version` —
 * which is a VERSION-INTEGRITY reason, about proving which bytes a signer was
 * shown. This register is about AUTHORITY, about which document governs. The
 * two justifications must not be merged; the out-of-scope register says so too.
 */
export type ReviewableConstantId =
    | 'courtesy_translation_notice'
    | 'report_view_disclosure';

/**
 * Who checked this wording, and when. A structured field, never prose.
 *
 * Not exported: it is reached as `ReviewedLanguageConstant['review']`, and an
 * exported name nobody imports is surface to keep in sync for no reason.
 */
interface ConstantReview {
    /** The reviewer. An entry that cannot name one is not an entry. */
    reviewedBy: string;
    /** What makes them qualified to review legal wording in this language. */
    qualification: string;
    /** ISO date, YYYY-MM-DD. */
    reviewedOn: string;
}

export interface ReviewedLanguageConstant {
    constantId: ReviewableConstantId;
    /** BCP-47 tag of the language this wording is authoritative in. */
    locale: string;
    /**
     * The version of the ENGLISH constant this review was made against. A
     * mismatch with the current English version refuses the entry.
     */
    version: number;
    /** The reviewed title, in `locale`. */
    title: string;
    /** The reviewed body, in `locale`. */
    text: string;
    review: ConstantReview;
}

/**
 * Empty, and asserted empty.
 *
 * @gateConsumed by `tests/unit/legal/reviewed-language-constants.spec.ts`,
 * which is what makes "nothing is promoted yet" a recorded state.
 */
export const REVIEWED_LANGUAGE_CONSTANTS: readonly ReviewedLanguageConstant[] = [];

/** The English wording a constant currently carries. */
export interface EnglishConstant {
    version: number;
    title: string;
    text: string;
}

/** What a renderer is handed. */
export interface ResolvedConstantText {
    /** The language the text below is in. `'en'` when nothing is promoted. */
    locale: string;
    title: string;
    text: string;
    /**
     * Whether this text IS the instrument in `locale`.
     *
     * True for the English original and for a promoted reviewed constant. It is
     * never true of a machine translation, which is the whole distinction this
     * module draws — a renderer branches on it to decide whether the
     * convenience-only framing applies to this span.
     */
    authoritative: boolean;
}

/**
 * The reviewed wording for one constant in one language, or the English.
 *
 * @param register injectable so a test can drive the promoted cases the empty
 *        shipped register cannot reach. Production callers pass nothing.
 */
export function resolveReviewedConstant(
    constantId: ReviewableConstantId,
    locale: string,
    english: EnglishConstant,
    register: readonly ReviewedLanguageConstant[] = REVIEWED_LANGUAGE_CONSTANTS,
): ResolvedConstantText {
    const fallback: ResolvedConstantText = {
        locale: 'en',
        title: english.title,
        text: english.text,
        authoritative: true,
    };

    const entry = register.find((e) => e.constantId === constantId && e.locale === locale);
    if (!entry) return fallback;

    // Version mismatch in EITHER direction. Behind means the English moved
    // under a reviewed rendering; ahead means somebody wrote a review against
    // wording this deployment does not ship. Both are a rendering nobody
    // reviewed against the text actually in force.
    if (entry.version !== english.version) return fallback;

    // An entry that cannot say who reviewed it is not a reviewed constant, and
    // serving it would be the one thing this disposition exists to prevent.
    if (
        entry.review.reviewedBy.trim() === ''
        || entry.review.qualification.trim() === ''
        || entry.review.reviewedOn.trim() === ''
    ) {
        return fallback;
    }

    if (entry.title.trim() === '' || entry.text.trim() === '') return fallback;

    return { locale: entry.locale, title: entry.title, text: entry.text, authoritative: true };
}
