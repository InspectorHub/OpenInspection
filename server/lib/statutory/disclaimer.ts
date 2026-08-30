/**
 * The notice that travels with a rendered statutory form.
 *
 * -- IT IS AN ALLOCATION STATEMENT, NOT A WAIVER -----------------------------
 * The notice says who did what: the authority published the form, the operator
 * of this software implemented it, and the inspector performed and certified
 * the inspection. It does not attempt to transfer risk, and the closing
 * sentence is there specifically to stop it drifting into an attempt.
 *
 * That sentence -- "if this software's rendering differs from the official
 * form, that difference is not made the inspector's responsibility merely by
 * this notice" -- is LOAD-BEARING. Its absence turns the rest into "if we drew
 * it wrong, that is your problem", which does not move the risk anywhere; it
 * only reads as though it did, which is worse than saying nothing because it
 * discourages the inspector from raising a rendering fault. A copy pass that
 * trims it for length changes what this notice is, so a test asserts it verbatim.
 *
 * -- ENGLISH IS AUTHORITATIVE, AND THIS FILE IMPORTS NO MESSAGE CATALOGUE -----
 * This text is a legal instrument rather than product copy, so it is a versioned
 * constant here and is registered in `lib/legal/non-translatable-manifest.ts`.
 * It deliberately does NOT import the message catalogue: a courtesy translation
 * of an allocation statement is the allocation arriving in a language nobody
 * agreed to be bound in. `scripts/check-non-translatable.mjs` fails hard on such
 * an import from a registered source.
 *
 * -- APOSTROPHES ARE U+2019, EVERY ONE ---------------------------------------
 * Not U+0027. They render almost identically, so a mismatch between this file
 * and its spec fails on a difference nobody can see, and the instinct is then to
 * change the test rather than the text. Stated here so the next editor picks the
 * same character.
 *
 * -- WHAT IT MUST NEVER SAY --------------------------------------------------
 * That the form is approved, endorsed or certified BY the issuing authority.
 * No such endorsement exists for an implementation, and claiming one is a
 * misrepresentation about a government body rather than a puff about us. Both a
 * test and `scripts/check-endorsement-copy.mjs` hold that line.
 */
import type { StatutoryFormVersion } from './form-registry';

/**
 * The notice, with slots. Rendered by `statutoryNoticeFor`.
 *
 * Kept as a template rather than assembled from fragments so the whole
 * statement can be read in one place, in the order a person reads it.
 */
export const STATUTORY_FORM_NOTICE = [
    '{software} provides this template as a software implementation of {form}, '
    + 'revision {revision}, effective {effective}.',

    '{software} does not perform or certify the inspection, does not verify the '
    + 'information entered by the inspector, and does not determine whether an '
    + 'inspection or report satisfies requirements applicable to the inspector’s '
    + 'circumstances.',

    'The inspector is responsible for the accuracy of inspection findings and '
    + 'certifications and for complying with applicable laws and regulations.',

    // ONE literal, deliberately, and the long line is the price. The
    // non-translatable gate reads this file as SOURCE TEXT and locates the entry
    // by a fragment of this sentence -- so splitting it across a concatenation
    // makes that fragment un-findable and the guardrail silently stops guarding.
    // Measured: it did exactly that on the first attempt.
    'If {software}’s rendering of the identified form differs from the applicable official form, that difference is not made the inspector’s responsibility merely by this notice.',
].join('\n\n');

/**
 * The effective date as it appears in the notice.
 *
 * UTC, formatted `YYYY-MM-DD`, because that is how the revision was CHOSEN
 * (`inspection-date.ts`). Formatting this one in local time could print the day
 * before the one that actually governs, on the very document where the date is
 * the point.
 */
export function formatEffectiveDate(epochMs: number): string {
    return new Date(epochMs).toISOString().slice(0, 10);
}

export interface StatutoryNoticeOptions {
    /**
     * What to call the software in the notice. Supplied by the deployment
     * rather than compiled in: a self-hosted operator's inspectors are not
     * using a product by our name, and a notice that names the wrong party is
     * an allocation statement that allocates to nobody.
     */
    softwareName: string;
}

/** Render the notice for one published revision. */
export function statutoryNoticeFor(
    version: StatutoryFormVersion,
    options: StatutoryNoticeOptions,
): string {
    return STATUTORY_FORM_NOTICE
        .replaceAll('{software}', options.softwareName)
        // The form's own TITLE, never `formId`. The id is a database key, and
        // this sentence is read by an inspector: "a software implementation of
        // fl_oir_b1_1802" names nothing they have ever held.
        .replaceAll('{form}', version.formTitle)
        .replaceAll('{revision}', version.version)
        .replaceAll('{effective}', formatEffectiveDate(version.effectiveFrom));
}
