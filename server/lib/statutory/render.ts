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
 */
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { validateAgainstPdf, validateFieldMapShape, type FieldMap, type FieldMapping } from './field-map';

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
 * Render one statutory form.
 *
 * @param officialPdf the exact published bytes — their hash must be the one the
 *   map was authored against, which is checked before anything is written.
 * @param map the field map for that revision.
 * @param values our field name -> the string to put on the form. A key that is
 *   PRESENT with an empty string is an answer of "nothing"; a key that is ABSENT
 *   is no answer at all, and for a required field that is refused.
 */
export async function renderStatutoryForm(
    officialPdf: Uint8Array,
    map: FieldMap,
    values: Readonly<Record<string, string>>,
): Promise<Uint8Array> {
    validateFieldMapShape(map);
    await validateAgainstPdf(map, officialPdf);
    // Read through a Map rather than by index: `Record<string, string>` types
    // every lookup as present, and this whole function turns on telling an
    // absent key from an empty one. The Map's `get` returns `string | undefined`,
    // so the compiler agrees with what actually happens at runtime.
    const supplied = new Map(Object.entries(values));
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

    for (const mapping of map.mappings) {
        const value = supplied.get(mapping.ourField);
        if (value === undefined) continue;

        if (mapping.kind === 'acroform') {
            setTextField(doc, mapping.pdfField, value);
            continue;
        }
        if (mapping.kind === 'overlay') {
            if (value === '') continue;
            pages[mapping.page].drawText(value, {
                x: mapping.x,
                y: mapping.y,
                size: mapping.size,
                font: await drawingFont(),
                ...(mapping.maxWidth === undefined ? {} : { maxWidth: mapping.maxWidth }),
            });
            continue;
        }
        if (value === mapping.whenValue) {
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
function setTextField(doc: PDFDocument, name: string, value: string): void {
    try {
        doc.getForm().getTextField(name).setText(value);
    } catch (cause) {
        throw new Error(
            `statutory render: "${name}" is not a text field on this form — an acroform mapping `
            + 'sets text, and a widget of another kind needs a mapping kind of its own',
            { cause },
        );
    }
}

/**
 * Every value has somewhere to go, and every required answer is present.
 *
 * Both directions are checked because they fail differently and both fail
 * silently. A value with no mapping disappears; a required field with no value
 * produces a form that looks filled and is not.
 */
function checkValuesAgainstMap(map: FieldMap, values: ReadonlyMap<string, string>): void {
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

    checkChoicesAreReachable(map.mappings, values);
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
    values: ReadonlyMap<string, string>,
): void {
    const answers = new Map<string, Set<string>>();
    for (const m of mappings) {
        if (m.kind !== 'checkbox') continue;
        const known = answers.get(m.ourField) ?? new Set<string>();
        known.add(m.whenValue);
        answers.set(m.ourField, known);
    }
    for (const [field, known] of answers) {
        const value = values.get(field);
        // An absent key is "not answered" and was already judged against
        // `requiredFields`; an empty string is an explicit "none of these".
        if (value === undefined || value === '') continue;
        if (!known.has(value)) {
            fail(`"${field}" was answered "${value}" and this form has no box for that answer `
                + `(it has: ${[...known].join(', ')})`);
        }
    }
}
