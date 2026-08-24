/**
 * The register of REVIEWED per-language constants, and the accessor that
 * decides which text a reader is shown.
 *
 * ## Why the register exists at all
 *
 * A notice that says "this translation is unofficial" is the text that DEFINES
 * WHICH DOCUMENT CARRIES AUTHORITY. It therefore cannot be produced by the
 * machinery it describes, and it cannot be an ordinary catalogue string a bulk
 * translation pass could silently reword. But a notice explaining that a
 * translation is unofficial is worth nothing to the one reader who needs it if
 * it arrives in a language they cannot read.
 *
 * The register is the way out of that: a target-language wording becomes
 * authoritative for one constant in one language only when a qualified legal
 * translator has reviewed it, and the review is recorded as a structured field
 * rather than as a sentence in a comment.
 *
 * ## Emptiness is a recorded state, not an absence
 *
 * Nothing is promoted today, and this file asserts that. Without the assertion,
 * "no language has been reviewed" and "somebody deleted the register" look
 * identical — and the second is the failure that ships an unreviewed sentence
 * as authoritative legal text.
 *
 * ⚠️ The pressure to promote will come from exactly the population least able
 * to check the result. "The client only reads Spanish" is an argument for MORE
 * care, never for less: a reader who cannot read the English half relies on the
 * translated one completely, which raises the accuracy requirement rather than
 * lowering it. A promotion made because a client base reads a language, rather
 * than because a translator reviewed the text, is the failure this whole
 * disposition exists to make visible.
 */
import { describe, it, expect } from 'vitest';
import {
    REVIEWED_LANGUAGE_CONSTANTS,
    resolveReviewedConstant,
    type ReviewedLanguageConstant,
} from '../../../server/lib/legal/reviewed-language-constants';
import { COURTESY_TRANSLATION_NOTICE, courtesyTranslationNoticeFor } from '../../../server/lib/legal/courtesy-translation-notice';

/** A promoted entry, built by hand, for the cases the empty register cannot reach. */
function promoted(over: Partial<ReviewedLanguageConstant> = {}): ReviewedLanguageConstant {
    return {
        constantId: 'courtesy_translation_notice',
        locale: 'es-419',
        version: COURTESY_TRANSLATION_NOTICE.version,
        title: 'Traducción de cortesía del informe de inspección',
        text: 'La versión en inglés es el registro oficial de la inspección.',
        review: {
            reviewedBy: 'A Qualified Legal Translator',
            qualification: 'sworn translator, ES<>EN',
            reviewedOn: '2026-08-24',
        },
        ...over,
    };
}

describe('the register ships empty, and says so', () => {
    it('is empty', () => {
        // Not "is falsy" and not "has no es-419 entry". The whole array, so a
        // promotion of ANY constant in ANY language has to walk past a red test.
        expect(REVIEWED_LANGUAGE_CONSTANTS).toEqual([]);
    });

    it('is an array, so the emptiness is a state rather than a missing export', () => {
        // The positive control for the assertion above: `undefined` also
        // "contains no entries", and would satisfy a laxer check.
        expect(Array.isArray(REVIEWED_LANGUAGE_CONSTANTS)).toBe(true);
    });
});

describe('an unpromoted locale is shown the authoritative English', () => {
    const english = {
        version: COURTESY_TRANSLATION_NOTICE.version,
        title: COURTESY_TRANSLATION_NOTICE.title,
        text: COURTESY_TRANSLATION_NOTICE.text,
    };

    it('returns the English text, and says it is authoritative', () => {
        const resolved = resolveReviewedConstant(
            'courtesy_translation_notice', 'es-419', english, [],
        );
        expect(resolved.text).toBe(COURTESY_TRANSLATION_NOTICE.text);
        expect(resolved.title).toBe(COURTESY_TRANSLATION_NOTICE.title);
        expect(resolved.locale).toBe('en');
        // The flag is what a renderer branches on. A reader shown English is
        // being shown the record itself, not a rendering of it.
        expect(resolved.authoritative).toBe(true);
    });

    it('does the same for a locale nobody has ever mentioned', () => {
        const resolved = resolveReviewedConstant(
            'courtesy_translation_notice', 'fr-CA', english, [],
        );
        expect(resolved.locale).toBe('en');
        expect(resolved.authoritative).toBe(true);
    });

    it('serves a promoted locale in that language — the positive control', () => {
        // Without this, an accessor that ignored the register entirely and
        // always returned English would satisfy every assertion above.
        const resolved = resolveReviewedConstant(
            'courtesy_translation_notice', 'es-419', english, [promoted()],
        );
        expect(resolved.locale).toBe('es-419');
        expect(resolved.text).toBe(promoted().text);
        // Promoted means AUTHORITATIVE in that language. That is the whole
        // difference between this disposition and a courtesy translation.
        expect(resolved.authoritative).toBe(true);
    });
});

describe('the key is (constant id, locale, version)', () => {
    const english = {
        version: COURTESY_TRANSLATION_NOTICE.version,
        title: COURTESY_TRANSLATION_NOTICE.title,
        text: COURTESY_TRANSLATION_NOTICE.text,
    };

    it('promoting one constant for a locale does not promote another', () => {
        const register = [promoted()];
        const other = resolveReviewedConstant(
            'report_view_disclosure', 'es-419',
            { version: 1, title: 'How this reached you', text: 'English body.' },
            register,
        );
        expect(other.locale).toBe('en');
        expect(other.text).toBe('English body.');
    });

    it('promoting one locale does not promote another', () => {
        const register = [promoted()];
        expect(resolveReviewedConstant('courtesy_translation_notice', 'pt-BR', english, register).locale)
            .toBe('en');
    });

    it('REFUSES an entry whose version does not match the current English', () => {
        // Reword-without-bump is exactly the failure `notice_version` exists to
        // make detectable, and a stale reviewed rendering is worse than none:
        // it is an unreviewed sentence wearing a reviewer's name.
        const stale = promoted({ version: COURTESY_TRANSLATION_NOTICE.version + 1 });
        const resolved = resolveReviewedConstant(
            'courtesy_translation_notice', 'es-419', english, [stale],
        );
        expect(resolved.locale).toBe('en');
        expect(resolved.text).toBe(COURTESY_TRANSLATION_NOTICE.text);
    });

    it('refuses a BEHIND version too, not only an ahead one', () => {
        const behind = promoted({ version: COURTESY_TRANSLATION_NOTICE.version - 1 });
        expect(resolveReviewedConstant('courtesy_translation_notice', 'es-419', english, [behind]).locale)
            .toBe('en');
    });
});

describe('every entry names who reviewed it', () => {
    it('refuses an entry with no reviewer recorded', () => {
        // An entry without one is not an entry: the disposition IS "a qualified
        // person checked this", so a row that cannot say who did is a
        // convenience translation with a better name.
        const anonymous = promoted({
            review: { reviewedBy: '  ', qualification: 'sworn translator', reviewedOn: '2026-08-24' },
        });
        const english = {
            version: COURTESY_TRANSLATION_NOTICE.version,
            title: COURTESY_TRANSLATION_NOTICE.title,
            text: COURTESY_TRANSLATION_NOTICE.text,
        };
        expect(resolveReviewedConstant('courtesy_translation_notice', 'es-419', english, [anonymous]).locale)
            .toBe('en');
    });
});

describe('the notice accessor', () => {
    it('hands a Spanish reader the English notice today, marked authoritative', () => {
        const shown = courtesyTranslationNoticeFor('es-419');
        expect(shown.locale).toBe('en');
        expect(shown.authoritative).toBe(true);
        expect(shown.text).toBe(COURTESY_TRANSLATION_NOTICE.text);
        expect(shown.title).toBe(COURTESY_TRANSLATION_NOTICE.title);
    });

    it('does not change the English constant or its version', () => {
        // The version is recorded on every stored translation, so a bump
        // orphans every one of those records. Pinned here so a change to the
        // accessor cannot drag the constant with it.
        expect(COURTESY_TRANSLATION_NOTICE.version).toBe(1);
        expect(COURTESY_TRANSLATION_NOTICE.title).toBe('Courtesy Translation of Inspection Report');
        expect(COURTESY_TRANSLATION_NOTICE.text.startsWith('The English version is the official')).toBe(true);
    });
});
