/**
 * Which of a form's questions exist for THIS inspection's answers.
 *
 * ── The fact this file is here to keep ──────────────────────────────────────
 * `values.ts` opens on it and this is the other half. A binding that resolves to
 * "the inspector answered nothing" emits its key with an empty string; a
 * question the form never asked emits NO KEY AT ALL. On the finished page the
 * two are the same blank, which is exactly why the difference has to be settled
 * here, before a document exists.
 *
 * Measured on FL OIR-B1-1802 Rev. 04/26, this is not a hypothetical shape. Its
 * question 8 prints four ways of sealing a roof deck and, one indent level under
 * the fourth, "check here if entire roof deck underside covered". Three of the
 * four methods are laid ON TOP of the deck and never touch its underside; spray
 * foam is applied from inside the attic. Modelled as a box at the same level as
 * the four, an inspector can answer "double layer of felt" and also claim the
 * whole underside is covered — a combination that cannot physically occur, on a
 * form that goes to an insurer and a state regulator. There is no gate anywhere
 * that reads a printed page for physics.
 *
 * ── Four refusals, and each one is a document that would otherwise print ────
 * Every rule below was chosen against the same test: what does the page look
 * like if this is allowed through? None of the answers is "an error"; all four
 * are "a form that prints, files, and is wrong".
 *
 *   A rule that gates a question on ITSELF          — a question that can never
 *                                                     be asked, so a box that
 *                                                     can never be ticked.
 *   A rule whose controlling field is unbound       — the same blank box,
 *                                                     arriving through a
 *                                                     misspelled field name.
 *   A rule with no answers at all                   — the same blank box again,
 *                                                     declared rather than
 *                                                     mistyped.
 *   The question applies and NOTHING is bound to it — the form asked, and the
 *                                                     template has no answer to
 *                                                     give it.
 *
 * The last of those is where a conditional question's REQUIREMENT lives. The
 * field map's `requiredFields` cannot carry it: that list means "required of
 * every inspection", and a conditional question is not — a form produced for an
 * inspection the question was never asked of is correct with the key missing.
 * Stating it here instead means the refusal can name the answer that asked the
 * question, which is the sentence the person fixing the template needs.
 *
 * ⚠️ A CHAIN IS NOT SUPPORTED, and that is a limit rather than a feature. Rules
 * are applied in declaration order against one values object, so a question
 * whose controlling field is ITSELF conditional would be judged against a key
 * that may or may not have been removed yet. No form measured needs one — the
 * 1802's three controlling questions (6, 8 and 9) are each asked of every
 * inspection — and the honest answer to the day one does is a dependency ORDER
 * computed from the graph, not a second pass here. Stated because the shape
 * compiles today and would be wrong in a way nothing reports.
 *
 * ── And one refusal for the answer that should not exist ────────────────────
 * A question that does not apply, answered anyway, is REFUSED rather than
 * quietly dropped. Dropping it would be right about the page and wrong about the
 * inspection: somebody recorded an observation, and a producer that silently
 * discards it teaches nobody that the two answers disagree. The refusal names
 * both fields and both answers, because the fix is to change one of them and the
 * person has to know which two are fighting.
 */
import type {
    StatutoryFieldDependency,
    StatutoryFormDeclaration,
} from '../../types/template-schema';
import { fail } from './resolve-source';

/**
 * One field's answer, or `undefined` when the values object has no such key.
 *
 * Read through `hasOwnProperty` and NOT by plain index, because this whole file
 * turns on telling an absent key from an empty one and a `Record<string, string>`
 * types every index as present. The compiler would then agree that
 * `values[field] === undefined` is impossible while it happens on every run —
 * the same reason `render.ts` reads its values through a Map.
 */
function answerOf(values: Record<string, string>, field: string): string | undefined {
    return Object.prototype.hasOwnProperty.call(values, field) ? values[field] : undefined;
}

/**
 * The shape rules, judged before any answer is read.
 *
 * Separate from the answer-dependent half below for the same reason
 * `validateFieldMapShape` is separate from `validateAgainstPdf`: these are
 * properties of the template alone, they are wrong for every inspection rather
 * than for this one, and reporting them against a particular inspection's
 * answers would send somebody looking at the wrong thing.
 */
export function refuseUnusableDependencies(declaration: StatutoryFormDeclaration): void {
    const dependencies = declaration.dependsOn;
    if (dependencies === undefined) return;

    for (const [ourField, rule] of Object.entries(dependencies)) {
        if (rule.field === ourField) {
            fail(`"${ourField}" declares that it only applies for certain answers to itself. `
                + 'A question cannot decide whether it was asked; nothing could ever tick that '
                + 'box.');
        }
        if (rule.answerIsOneOf.length === 0) {
            fail(`"${ourField}" applies for none of the answers to "${rule.field}", so the form `
                + 'would never ask it at all. A question that can never exist reads on the page '
                + 'exactly like one nobody answered — declare the answers it belongs to, or drop '
                + 'the rule.');
        }
        if (!(rule.field in declaration.bindings)) {
            fail(`"${ourField}" applies only for certain answers to "${rule.field}", and this `
                + 'template binds nothing to that field. Nothing can ever answer it, so this '
                + 'question would never be asked — check the spelling of the field name against '
                + 'the bindings.');
        }
    }
}

/**
 * Does the form ask this question, given what has been answered so far?
 *
 * An ARRAY answer to the controlling field is deliberately not accepted here.
 * Every conditional question measured hangs off a single-choice question — the
 * 1802's questions 6, 8 and 9 each print "check only one" — and a multi-select
 * controller would have to decide whether "any of these" or "all of these"
 * opens the question, which is a reading of the form's text and not a default.
 * The values object at this point holds strings only (`collectStatutoryValues`
 * stringifies everything), so this is the whole vocabulary.
 */
function applies(rule: StatutoryFieldDependency, values: Record<string, string>): boolean {
    // An unresolved controlling field cannot be distinguished from one answered
    // with something outside the list, and both mean the same thing: the form
    // did not ask. `refuseUnusableDependencies` has already established that
    // SOMETHING is bound to it, so this is an inspection that has not reached
    // that question rather than a template that forgot it.
    const controlling = answerOf(values, rule.field);
    return controlling !== undefined && rule.answerIsOneOf.includes(controlling);
}

/**
 * Apply every dependency to a resolved values object, IN PLACE.
 *
 * In place because the alternative is a second object that differs from the
 * first only by absences, and an absence is the one thing a reader cannot see
 * when comparing two objects. The caller holds one values object throughout, and
 * what happened to it is described by the refusals rather than by a diff.
 *
 * ⚠️ ORDER. This runs AFTER every binding is resolved, because a rule reads
 * another field's answer and there is no ordering of the bindings that
 * guarantees a controlling field is resolved first. It runs BEFORE overflow is
 * routed, because a routed line is appended to a field that must still be there
 * when it lands.
 */
export function applyDependencies(
    declaration: StatutoryFormDeclaration,
    values: Record<string, string>,
): void {
    const dependencies = declaration.dependsOn;
    if (dependencies === undefined) return;

    for (const [ourField, rule] of Object.entries(dependencies)) {
        const bound = ourField in declaration.bindings;
        if (!applies(rule, values)) {
            refuseAnswerToAQuestionNobodyAsked(ourField, rule, values);
            // NO KEY. Not an empty string: an empty string is an answer, and
            // this question was never put. The renderer leaves the box alone
            // either way, and the difference is what the two of them can say
            // about the inspection afterwards.
            delete values[ourField];
            continue;
        }
        if (!bound) {
            fail(`the form asks "${ourField}" whenever "${rule.field}" is answered `
                + `"${answerOf(values, rule.field) ?? ''}", and this template binds nothing to it. `
                + 'That is a question on the authority\'s page with no answer behind it, which '
                + 'prints as a box the inspector skipped.');
        }
        refuseLabelThatBelongsToAnotherAnswer(ourField, rule, values);
    }
}

/**
 * An answer to a question the form did not ask.
 *
 * Only a NON-EMPTY answer is refused. An empty one is somebody who opened the
 * item and left it alone, which says nothing that contradicts anything; refusing
 * it would make a form unproducible over a blank field the page has no box for.
 */
function refuseAnswerToAQuestionNobodyAsked(
    ourField: string,
    rule: StatutoryFieldDependency,
    values: Record<string, string>,
): void {
    const own = answerOf(values, ourField);
    if (own === undefined || own === '') return;
    const controlling = answerOf(values, rule.field);
    fail(`"${ourField}" is answered "${own}", and this form only asks it when "${rule.field}" is `
        + `${rule.answerIsOneOf.map((a) => `"${a}"`).join(' or ')} — it is answered `
        + `${controlling === undefined || controlling === '' ? 'nothing' : `"${controlling}"`}. `
        + 'One of the two answers is wrong, and printing both would tick boxes on the page that '
        + 'contradict each other.');
}

/**
 * The label on this answer names the answer it belongs under.
 *
 * Measured on FL OIR-B1-1802 question 9: the twelve non-glazed sub-levels are
 * printed `A.1` through `N.3`, in one continuous run of boxes, under the six
 * letters of the question above them. The letter is not decoration — `A.2` is a
 * LINE PRINTED UNDER A. Answering `C.2` while the question above says `A` ticks
 * two boxes that the page itself sets against each other, and every count of
 * answered fields still reads complete.
 *
 * The message names the two answers rather than the rule, because "validation
 * failed" tells the inspector to go and find somebody who understands the
 * software, and "you chose A above and C.2 below" tells him which box to change.
 */
function refuseLabelThatBelongsToAnotherAnswer(
    ourField: string,
    rule: StatutoryFieldDependency,
    values: Record<string, string>,
): void {
    const separator = rule.labelSeparator;
    if (separator === undefined) return;
    const own = answerOf(values, ourField);
    // Absent is a template that bound nothing, judged above; empty is a question
    // asked and not answered, which is an answer this form can carry.
    if (own === undefined || own === '') return;
    // Non-undefined by `applies`, which is the only path here; narrowed rather
    // than asserted, because an assertion would survive that changing.
    const controlling = answerOf(values, rule.field);
    if (controlling === undefined) return;
    if (own.startsWith(`${controlling}${separator}`)) return;
    fail(`"${rule.field}" is answered "${controlling}" and "${ourField}" is answered "${own}". `
        + `The form prints those two under different letters — a "${ourField}" line belongs to `
        + `"${controlling}" only when it reads "${controlling}${separator}…". Change whichever of `
        + 'the two boxes was ticked in error.');
}

/**
 * A repeated block may not send its overflow into a conditional field.
 *
 * The destination is where instances the page has no slot for are written, and
 * it is chosen because the form itself nominates that box ("use additional pages
 * if needed"). A box the form only prints for some answers cannot be that: on
 * every other answer set the third panel would be written into a key that has
 * just been deleted, land back in the values object as if nothing were wrong,
 * and reach the page as a value the renderer has no mapping for.
 */
export function refuseConditionalOverflowDestination(
    declaration: StatutoryFormDeclaration,
): void {
    const dependencies = declaration.dependsOn;
    if (dependencies === undefined || declaration.groups === undefined) return;
    for (const group of declaration.groups) {
        const destination = group.overflowTo;
        if (destination === undefined) continue;
        const rule = dependencies[destination];
        if (rule === undefined) continue;
        fail(`group "${group.id}" overflows into "${destination}", which this form only asks when `
            + `"${rule.field}" is answered `
            + `${rule.answerIsOneOf.map((a) => `"${a}"`).join(' or ')}. An instance the page has `
            + 'no slot for would then have nowhere to go on every other answer, which is the '
            + 'silent drop `overflowTo` exists to end.');
    }
}
