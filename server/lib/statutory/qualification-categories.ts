/**
 * The qualification categories an authority PRINTS, for the box that asks the
 * signer which one he holds.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `users.statutory_qualification` is a text column, and the profile screen used
 * to answer it with a free-text input whose placeholder read
 * "e.g. Building code inspector". The FL OIR-B1-1802 does not have a box for a
 * sentence: it prints six checkboxes and says "(check one)", and the value the
 * published field map ticks a box against is `building_code_inspector`. So the
 * input was TEACHING a value that cannot work. It did not print blank -- the
 * renderer refuses an answer no mapping names, by name -- but that refusal
 * arrives after the fieldwork, on the day the inspector tries to produce the
 * document.
 *
 * Transcribing the six is not inventing them. They are on page 5 of the adopted
 * form, under the heading reproduced below, and the whole statutory subsystem
 * exists to reproduce an authority's own text rather than paraphrase it.
 *
 * ── THE VALUE IS THE CONTRACT, THE LABEL IS THE COURTESY ────────────────────
 * `value` is what is stored and what `render.ts` compares byte-for-byte against
 * a mapping's `whenValue`. `printedAs` is what the form says, shown so the
 * person choosing can recognise his own category; it reaches no document.
 * STORING A LABEL WOULD SILENTLY PRINT AN EMPTY FORM, which is the exact shape
 * of the failure this subsystem is built to prevent, so the two must never be
 * swapped. `tests/unit/statutory-forms/qualification-categories.spec.ts` holds
 * the values against the published map in both directions rather than against a
 * literal copied out of this file.
 *
 * ── WHY IT IS NOT IN THE MESSAGE CATALOGUE ──────────────────────────────────
 * These sentences are the authority's, and a translated one would name a
 * category the form does not print -- the reader would be choosing between six
 * options that do not appear on the page he is about to sign. Same reasoning,
 * and the same shape, as `server/lib/legal/agreement-language-disclosure.ts`.
 * The surrounding label, hint and the "not declared" option ARE ours and stay
 * translatable.
 *
 * ── ONE AUTHORITY ASKS THIS TODAY, AND THE COLUMN IS SINGULAR ───────────────
 * Of the four published forms only the 1802 prints a qualification block; the
 * others ask for a licence CLASS, which is a different axis and stays free text
 * because those forms draw it as a line to write on rather than as boxes. If a
 * second authority ever prints its own list, one column cannot answer both
 * vocabularies and this list cannot simply grow -- that is a schema decision,
 * not an edit here. Written down because the tempting move on that day is to
 * append.
 */

/** One printed category: the stored value, and the sentence beside its box. */
export interface StatutoryQualificationCategory {
    /** Stored in `users.statutory_qualification`, matched against `whenValue`. */
    readonly value: string;
    /** The authority's own sentence, transcribed from the form. Never stored. */
    readonly printedAs: string;
}

/**
 * The line the form prints above the six boxes, transcribed. Shown as the
 * group's legend so the choice is presented the way the page presents it.
 */
export const FL_1802_QUALIFICATION_PROMPT
    = 'Qualified Inspector – I hold an active license as a: (check one)';

/**
 * FL OIR-B1-1802 (Rev. 04/26), page 5, in the order the form prints them.
 *
 * The order is the page's order and not an alphabetisation: a person looking
 * for his own line reads down the list on the paper in front of him.
 */
export const FL_1802_QUALIFICATION_CATEGORIES: readonly StatutoryQualificationCategory[] = [
    {
        value: 'home_inspector',
        printedAs: 'Home inspector licensed under Section 468.8314, Florida Statutes, who has '
            + 'completed the statutory number of hours of hurricane mitigation training approved '
            + 'by the Construction Industry Licensing Board and completion of a proficiency exam.',
    },
    {
        value: 'building_code_inspector',
        printedAs: 'Building code inspector certified under Section 468.607, Florida Statutes.',
    },
    {
        value: 'contractor',
        printedAs: 'General, building, or residential contractor licensed under Section 489.111, '
            + 'Florida Statutes.',
    },
    {
        value: 'professional_engineer',
        printedAs: 'Professional engineer licensed under Section 471.015, Florida Statutes.',
    },
    {
        value: 'professional_architect',
        printedAs: 'Professional architect licensed under Section 481.213, Florida Statutes.',
    },
    {
        value: 'other_recognized_by_insurer',
        printedAs: 'Any other individual or entity recognized by the insurer as possessing the '
            + 'necessary qualifications to properly complete a uniform mitigation verification '
            + 'form pursuant to Section 627.711(2), Florida Statutes.',
    },
];
