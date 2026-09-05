/**
 * Every refusal a statutory render makes BEFORE a document exists.
 *
 * ── Why these live together, and away from the drawing ──────────────────────
 * `render.ts` answers "how does a value get onto the authority's page". These
 * answer "may this document be produced at all", and every one of them is
 * decided against the map and the values alone — no PDF is loaded, nothing is
 * drawn, and nothing is written. That is not a filing convenience: each refusal
 * here exists because the alternative is a document that PRINTS AND LOOKS
 * FILLED, and the only moment at which that can still be prevented is before
 * there is a document to look at.
 *
 * ── The four failures ───────────────────────────────────────────────────────
 *   1. a value with no mapping — it would simply disappear;
 *   2. a required field with no answer — the box prints blank over a signature;
 *   3. an answer no box on the form can take — a list where text is drawn, or
 *      an option this revision has no box for;
 *   4. a value that cannot be split into the blanks the form prints for it.
 *
 * The prefix on every message names the RENDER rather than this module, for the
 * reason `fit.ts` gives about its own: the reader is a person holding a form,
 * and telling them which file refused tells them where our code lives instead
 * of what happened to their document.
 */
import type { FieldMap, FieldMapping, StatutoryValue } from './field-map';
import { refuseUnreadableParts } from './value-parts';
import type { SignatureImage } from './render-signature';

function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/**
 * Nothing was answered here — no key at all, or a key carrying no answer.
 *
 * ⚠️ THIS PREDICATE IS ONLY EVER APPLIED TO `requiredFields`, and the difference
 * is the whole point. Everywhere else an empty string is an ANSWER — the
 * inspector looked at the box and had nothing to put in it — and a form carrying
 * one must still be producible. `requiredFields` says something narrower and
 * stronger: this box is required of EVERY inspection, so there is no inspection
 * for which leaving it empty is a legitimate answer.
 *
 * Measured on the FL Citizens roof form: `inspector_signature_date` binds to a
 * column nobody had filled in, resolved to '', and the form came out with the
 * signing date blank — while page 1 of that form prints, verbatim, that it
 * "will not be accepted without the dated signature". The inspector had no way
 * to know: the document produced, printed, and looked complete.
 *
 * An empty LIST is not tested here. `asAnswer` never produces one — it collapses
 * to '' — and `refuseAnswersNoBoxCanTake` refuses one by name for every field,
 * required or not. Restating that rule here would be a second copy of it, and
 * the second copy is the one that stops being maintained.
 */
function hasNoAnswer(value: StatutoryValue | undefined): boolean {
    return value === undefined || value === '';
}

/**
 * Which fields this form REQUIRES still have no answer, in the map's own order.
 *
 * Exported because two surfaces must agree about it and they run at different
 * times: this list is what the refusal above names when a form is produced, and
 * it is also what the editor shows an inspector WHILE they still have the
 * inspection open. Those two used to be one buried `.filter()`, so the only way
 * to learn what was missing was to finish the job, publish the report to the
 * client, and be refused -- by which point the report has already gone out.
 *
 * ⚠️ ONE RULE, TWO CALLERS -- never a second copy. A coverage indicator that
 * computed "still missing" its own way would agree with the refusal on the day
 * it was written and drift silently afterwards, and the failure mode of that
 * drift is the worst one available here: a checklist that reads complete over a
 * form that will be refused, or over one that produces a blank box on an
 * authority's page.
 *
 * A signature counts as answered when it arrives through its own channel, for
 * the reason `checkValuesAgainstMap` gives: it fills its box without ever being
 * a value.
 */
export function missingRequiredFields(
    map: FieldMap,
    values: ReadonlyMap<string, StatutoryValue>,
    signatures: ReadonlyMap<string, SignatureImage>,
): string[] {
    return map.requiredFields.filter(
        (f) => !signatures.has(f) && hasNoAnswer(values.get(f)),
    );
}

/**
 * Every value has somewhere to go, and every required answer is present.
 *
 * Both directions are checked because they fail differently and both fail
 * silently. A value with no mapping disappears; a required field with no value
 * produces a form that looks filled and is not.
 */
export function checkValuesAgainstMap(
    map: FieldMap, values: ReadonlyMap<string, StatutoryValue>,
    signatures: ReadonlyMap<string, SignatureImage>,
): void {
    const mapped = new Set(map.mappings.map((m) => m.ourField));
    // Signatures too: a mark with nowhere to go is an empty signature box.
    const unmapped = [...values.keys(), ...signatures.keys()].filter((k) => !mapped.has(k));
    if (unmapped.length > 0) {
        fail(`${unmapped.length} value(s) have no mapping on ${map.formId} ${map.version} and would `
            + `be dropped: ${unmapped.join(', ')}`);
    }

    const missing = missingRequiredFields(map, values, signatures);
    if (missing.length > 0) {
        fail(`${missing.length} required field(s) have no answer: ${missing.join(', ')}. `
            + 'A field this form REQUIRES is required of every inspection, so an answer of '
            + 'nothing is refused here exactly as a binding nobody made is: both print the same '
            + "blank box on the authority's page, and a blank box reads as an inspector who did "
            + 'not answer. Everywhere else on this form an empty string is a perfectly good '
            + 'answer and stays one.');
    }

    refuseAnswersNoBoxCanTake(map.mappings, values);
    checkChoicesAreReachable(map.mappings, values);
    // Judged here, before the document is loaded, for the same reason an
    // overflow is: a person with several broken bindings should be told about
    // all of them, not sent back once per binding. The RULE is `partOfValue`
    // and this is a second call of it, never a second copy.
    refuseUnreadableParts(map.mappings, values);
}

/**
 * A choice must land in a box that exists.
 *
 * The dangerous case: the FIELD is mapped, so every count of mapped fields looks
 * complete, and the ANSWER given matches none of its boxes — so nothing is
 * marked and the form comes out with that question unanswered.
 */
function checkChoicesAreReachable(
    mappings: readonly FieldMapping[],
    values: ReadonlyMap<string, StatutoryValue>,
): void {
    for (const [field, known] of boxesByField(mappings)) {
        const value = values.get(field);
        // An absent key is "not answered" and was already judged against
        // `requiredFields`; an empty string is an explicit "none of these".
        if (value === undefined || value === '') continue;
        // EVERY element, not the first. Three good options and one that matches
        // nothing is a question that comes out three-quarters answered, with
        // every count of answered fields still reading complete.
        for (const chosen of typeof value === 'string' ? [value] : value) {
            if (known.has(chosen)) continue;
            fail(`"${field}" was answered "${chosen}" and this form has no box for that answer `
                + `(it has: ${[...known].join(', ')})`);
        }
    }
}

/** Which answers each multiple-choice field has a box for. */
function boxesByField(mappings: readonly FieldMapping[]): Map<string, Set<string>> {
    const answers = new Map<string, Set<string>>();
    for (const m of mappings) {
        // Both box kinds: a drawn mark and a set widget are one question with
        // one set of answers, and a form may only carry one of the two.
        if (m.kind !== 'checkbox' && m.kind !== 'acroform_checkbox') continue;
        const known = answers.get(m.ourField) ?? new Set<string>();
        known.add(m.whenValue);
        answers.set(m.ourField, known);
    }
    return answers;
}

/**
 * A list of options is only an answer where the form printed a list of boxes.
 *
 * Two refusals, and both are about a document that would otherwise print and
 * look filled.
 *
 * An EMPTY array. `StatutoryValue` says why at length: "none of these" is the
 * empty string, and a second spelling of one answer means every reader has to
 * know which one their producer emits. An empty list is also what a binding that
 * resolved nothing yields, and a question with no box ticked reads exactly like
 * a question nobody was asked.
 *
 * An array reaching a mapping that writes TEXT. There is no right way to draw a
 * list onto one printed blank: joining it would put a separator of ours onto an
 * authority's document, and these forms print their own separators — which is
 * the whole reason `part` exists.
 */
function refuseAnswersNoBoxCanTake(
    mappings: readonly FieldMapping[],
    values: ReadonlyMap<string, StatutoryValue>,
): void {
    const writesText = new Set(
        mappings
            .filter((m) => m.kind !== 'checkbox' && m.kind !== 'acroform_checkbox')
            .map((m) => m.ourField),
    );
    for (const [field, value] of values) {
        if (typeof value === 'string') continue;
        if (value.length === 0) {
            fail(`"${field}" was answered with an empty list. A list is the options a `
                + 'question chose, and choosing none of them is written as an empty string, '
                + 'which is an answer this form can carry. An empty list is what a binding '
                + 'that resolved nothing produces, and the two must not look the same.');
        }
        if (writesText.has(field)) {
            fail(`"${field}" was answered with a list of ${value.length} and is mapped to `
                + 'something that writes text rather than to a set of boxes. Joining the list '
                + 'would put a separator of ours onto the published form, which is '
                + 'the failure the "part" mapping exists to prevent.');
        }
    }
}
