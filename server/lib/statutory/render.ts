/**
 * Write our values onto the authority's own PDF. The output IS their document.
 *
 * ── Why not lay the form out ourselves ──────────────────────────────────────
 * The requirement a statutory form has to meet is not "looks like the official
 * form": it is text verbatim, spacing identical, borders identical, placement
 * identical. Rebuilding the layout — in HTML through a browser renderer, or in
 * drawing calls here — can only ever approach that, and the gap is invisible
 * from the inside. A rebuilt form passes every assertion about its own values
 * and prints something the agency did not publish.
 *
 * So the agency's file is the substrate. We load it, put values into the places
 * a person measured, and save. Identity with the published document is then
 * structural rather than something we keep achieving, and it is measurable:
 * `tests/unit/statutory-forms/render.spec.ts` digests every page's content
 * stream before and after and requires the untouched ones to be byte-identical.
 *
 * ── Two ways in, because official forms come in two shapes ──────────────────
 * A fillable form takes values through its named fields; a form that is a word
 * processor print-out has no fields at all and takes them as text drawn at
 * measured coordinates. Both are `pdf-lib`, which is already a runtime
 * dependency here.
 *
 * ⚠️ A value with no route onto the page is REFUSED, never dropped. A dropped
 * value is a blank on a statutory document, and a blank looks exactly like an
 * answer nobody had. That is also why a required field missing from `values`
 * refuses: a form nobody filled must not be producible, while a form somebody
 * filled with an empty answer must be.
 *
 * ⚠️ AND THIS IS THE ONLY PLACE THAT DISTINCTION CAN LIVE. Measured against the
 * format: a form field set to an empty string is stored by storing nothing, so
 * it reads back identically to one that was never set. No later reader of the
 * document can tell the two apart. The refusal below happens before a document
 * exists, which is why it is a refusal and not a warning.
 *
 * ⚠️ LIMIT, stated rather than discovered later: an `acroform` mapping sets a
 * TEXT field. A fillable form whose checkboxes are real widgets is not covered —
 * such a mapping throws rather than quietly leaving the box unticked.
 *
 * ── A question with several boxes may have several of them ticked ───────────
 * An answer is a string OR a list of options. A string marks the one box it
 * names, exactly as it always has; a list marks every box it names, which is
 * what a multi-select question on these forms actually is — 6 boxes for the
 * Citizens photo requirements, 13 for electrical hazards, 8 for wiring types, 8
 * for pipe types, 8 for roof damage signs, 7 for the 1802's roof coverings.
 *
 * The two refusals that go with it are in `refuseAnswersNoBoxCanTake`, and both
 * exist because the alternative prints and looks filled: an empty list (which is
 * the empty string's job, and is what a binding that resolved nothing yields),
 * and a list reaching a mapping that writes text.
 *
 * ── A value too big for its space is refused, never made to look like it fit ──
 * The two routes fail in mirror image and both leave a document that LOOKS
 * filled. Drawn text wraps downward with no height bound, so a long answer runs
 * over the row beneath it; a form field clips whatever its widget cannot show.
 * On the two forms measured, 47 of 72 overlay rows and 47 of 48 have room for a
 * single line, so this is the ordinary case rather than the edge one.
 *
 * So a value is fitted, then shrunk to a floor the map declares, and then
 * refused. The measuring, and the reasoning behind refusing rather than
 * truncating, live in `fit.ts`.
 */
import { PDFDocument, StandardFonts, type PDFFont, type PDFTextField } from 'pdf-lib';
import {
    validateAgainstPdf, validateFieldMapShape,
    type FieldMap, type FieldMapping, type StatutoryValue,
} from './field-map';
import { fitOverlay, refuseIfTheWidgetWouldClip } from './fit';
import { partOfValue, refuseUnreadableParts } from './value-parts';

/**
 * How large a checkbox mark is drawn when the map does not say.
 *
 * A mark is not text the form asked for, so most maps have no reason to carry a
 * size; where a box is unusually small the mapping may override it.
 */
const DEFAULT_MARK_SIZE = 10;

/** The glyph drawn into a box. One character, from the standard font set. */
const MARK = 'X';

function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/**
 * Does this answer name that box?
 *
 * A string names the one option it is. An array names every option in it, which
 * is what a question with several boxes ticked looks like on the way in.
 */
function answerNames(value: StatutoryValue, whenValue: string): boolean {
    return typeof value === 'string' ? value === whenValue : value.includes(whenValue);
}

/**
 * The one string this answer is, for a mapping that writes text.
 *
 * `refuseAnswersNoBoxCanTake` already refused every array that reached anything
 * but a checkbox, so this cannot fire in practice — it keeps the type honest
 * rather than restating that rule, exactly as `value-parts.ts` does for a part
 * with no maxWidth.
 */
function oneAnswer(value: StatutoryValue, ourField: string): string {
    if (typeof value === 'string') return value;
    fail(`"${ourField}" was answered with a list and this mapping writes text`);
}

/**
 * Render one statutory form.
 *
 * @param officialPdf the exact published bytes — their hash must be the one the
 *   map was authored against, which is checked before anything is written.
 * @param map the field map for that revision.
 * @param values our field name -> the answer to put on the form. A key that is
 *   PRESENT with an empty string is an answer of "nothing"; a key that is ABSENT
 *   is no answer at all, and for a required field that is refused. An ARRAY is
 *   several options of one multi-select question and marks every box it names —
 *   see `StatutoryValue` for why an empty one is not a third case.
 */
export async function renderStatutoryForm(
    officialPdf: Uint8Array,
    map: FieldMap,
    values: Readonly<Record<string, StatutoryValue>>,
): Promise<Uint8Array> {
    validateFieldMapShape(map);
    await validateAgainstPdf(map, officialPdf);
    // Read through a Map rather than by index: `Record<string, ...>` types every
    // lookup as present, and this whole function turns on telling an absent key
    // from an empty one. The Map's `get` returns `... | undefined`, so the
    // compiler agrees with what actually happens at runtime.
    const supplied = new Map<string, StatutoryValue>(Object.entries(values));
    checkValuesAgainstMap(map, supplied);

    const doc = await PDFDocument.load(officialPdf);
    const pages = doc.getPages();
    // Embedded on first use only: a form filled entirely through its own fields
    // needs no font of ours, and adding one would put an object of ours into a
    // document we did not otherwise touch.
    let font: PDFFont | null = null;
    const drawingFont = async (): Promise<PDFFont> => {
        font ??= await doc.embedFont(StandardFonts.Helvetica);
        return font;
    };
    // A font for MEASURING, embedded in a scratch document rather than in the
    // agency's, for the same reason: needing to measure a widget is not grounds
    // for putting an object of ours into a document we otherwise leave alone.
    let ruler: PDFFont | null = null;
    const measuringFont = async (): Promise<PDFFont> => {
        ruler ??= await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
        return ruler;
    };

    for (const mapping of map.mappings) {
        if (mapping.kind === 'signature') {
            // The mapping kind exists so a field map can be authored against a
            // form that has signature boxes; drawing the image is not built yet.
            // Skipping it silently would produce a form with an empty signature
            // box — which prints, looks complete, and passes every assertion
            // about its own values. Fail instead.
            //
            // The refusal is BEFORE the value lookup on purpose: a signature
            // resolves by reference and never arrives through `values`, so a
            // check placed after it would find nothing to skip and skip anyway.
            fail(`signature rendering is not implemented; "${mapping.ourField}" `
                + 'cannot be produced yet');
        }

        const value = supplied.get(mapping.ourField);
        if (value === undefined) continue;

        if (mapping.kind === 'acroform') {
            setTextField(doc, mapping, oneAnswer(value, mapping.ourField), await measuringFont());
            continue;
        }
        if (mapping.kind === 'overlay') {
            const text = oneAnswer(value, mapping.ourField);
            if (text === '') continue;
            const drawn = await drawingFont();
            // A part draws one piece of the value into one printed blank; an
            // unparted overlay draws all of it, exactly as it always has.
            // `refuseUnreadableParts` already ran this over every part mapping,
            // so it cannot fail here.
            const drawing = mapping.part === undefined
                ? text
                : partOfValue(text, mapping.part, mapping.ourField);
            const fitted = fitOverlay(drawing, mapping, drawn);
            pages[mapping.page].drawText(drawing, {
                x: mapping.x,
                y: mapping.y,
                size: fitted.size,
                font: drawn,
                ...(mapping.maxWidth === undefined ? {} : { maxWidth: mapping.maxWidth }),
                // Passed only where a height was measured. pdf-lib's default line
                // height is a fixed 24 points whatever the font size, so an
                // overlay we fitted has to be drawn with the spacing it was
                // fitted at or the measurement describes a different page than
                // the one that comes out. An unbounded overlay keeps the old
                // spacing, because nothing was measured to justify changing it.
                ...(fitted.lineHeight === null ? {} : { lineHeight: fitted.lineHeight }),
            });
            continue;
        }
        if (answerNames(value, mapping.whenValue)) {
            pages[mapping.page].drawText(MARK, {
                x: mapping.x,
                y: mapping.y,
                size: mapping.size ?? DEFAULT_MARK_SIZE,
                font: await drawingFont(),
            });
        }
    }

    return doc.save();
}

/** Set one named text field, refusing rather than guessing at any other kind. */
function setTextField(
    doc: PDFDocument,
    mapping: Extract<FieldMapping, { kind: 'acroform' }>,
    value: string,
    ruler: PDFFont,
): void {
    let field: PDFTextField;
    try {
        field = doc.getForm().getTextField(mapping.pdfField);
    } catch (cause) {
        throw new Error(
            `statutory render: "${mapping.pdfField}" is not a text field on this form — an acroform `
            + 'mapping sets text, and a widget of another kind needs a mapping kind of its own',
            { cause },
        );
    }
    refuseIfTheWidgetWouldClip(field, mapping.ourField, value, ruler);
    field.setText(value);
}

/**
 * Every value has somewhere to go, and every required answer is present.
 *
 * Both directions are checked because they fail differently and both fail
 * silently. A value with no mapping disappears; a required field with no value
 * produces a form that looks filled and is not.
 */
function checkValuesAgainstMap(
    map: FieldMap, values: ReadonlyMap<string, StatutoryValue>,
): void {
    const mapped = new Set(map.mappings.map((m) => m.ourField));
    const unmapped = [...values.keys()].filter((k) => !mapped.has(k));
    if (unmapped.length > 0) {
        fail(`${unmapped.length} value(s) have no mapping on ${map.formId} ${map.version} and would `
            + `be dropped: ${unmapped.join(', ')}`);
    }

    const missing = map.requiredFields.filter((f) => !values.has(f));
    if (missing.length > 0) {
        fail(`${missing.length} required field(s) were never supplied: ${missing.join(', ')}. `
            + 'An empty string is an answer; an absent key is not, and a form nobody filled must '
            + 'not read as one somebody filled and left blank.');
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
        if (m.kind !== 'checkbox') continue;
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
        mappings.filter((m) => m.kind !== 'checkbox').map((m) => m.ourField),
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
