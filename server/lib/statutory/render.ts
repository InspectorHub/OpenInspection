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
 * answer nobody had. Likewise a required field with no answer in `values`: a
 * form nobody filled must not be producible, while an OPTIONAL box filled with
 * an empty answer must be. For a required field the two cases collapse — an
 * absent key and an empty one both print the same blank, and `requiredFields`
 * is the map's statement that no inspection may leave this box blank.
 *
 * ⚠️ AND THIS IS THE ONLY PLACE THAT DISTINCTION CAN LIVE. Measured against the
 * format: a form field set to an empty string is stored by storing nothing, so
 * it reads back identically to one that was never set. No later reader of the
 * document can tell the two apart. The refusal below happens before a document
 * exists, which is why it is a refusal and not a warning.
 *
 * ⚠️ A NAMED FIELD IS SET AS THE KIND IT IS. `acroform` sets a text field and
 * `acroform_checkbox` sets a `/Btn` widget; each refuses a field of the other
 * kind rather than guessing, because guessing sets nothing and raises nothing.
 *
 * That second route exists because of what the Texas form turned out to be: 245
 * fields, 81 text and 164 real checkbox widgets. A map that DRAWS a mark at a
 * coordinate inside one of those produces a document that is right on paper and
 * wrong in its data — every box still reads as unticked to anything that opens
 * the file, and the widget's own off-state appearance is painted after page
 * content and may cover the mark outright.
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
import {
    PDFDocument, ParseSpeeds, StandardFonts,
    type PDFCheckBox, type PDFFont, type PDFTextField,
} from 'pdf-lib';
import {
    validateAgainstPdf, validateFieldMapShape,
    type FieldMap, type FieldMapping, type StatutoryValue,
} from './field-map';
import { fitOverlay, refuseIfTheWidgetWouldClip } from './fit';
import { partOfValue } from './value-parts';
import { drawSignature, type SignatureImage } from './render-signature';
// Every refusal made before a document exists. Its own file because it answers
// a different question from this one -- see its header.
import { checkValuesAgainstMap } from './value-checks';

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
 *   is no answer at all. For a field named in `requiredFields` BOTH are refused,
 *   because that list says the box is required of every inspection. An ARRAY is
 *   several options of one multi-select question and marks every box it names —
 *   see `StatutoryValue` for why an empty one is not a third case.
 * @param signatures our field name -> a decoded signature image. A SEPARATE
 *   channel on purpose: a signature is the most tightly classified personal data
 *   this repository holds and `values` is declared to carry none. It still
 *   counts as SUPPLIED for the required-field check, whose question is only
 *   whether the box will be filled.
 */
export async function renderStatutoryForm(
    officialPdf: Uint8Array,
    map: FieldMap,
    values: Readonly<Record<string, StatutoryValue>>,
    signatures: ReadonlyMap<string, SignatureImage> = new Map(),
): Promise<Uint8Array> {
    validateFieldMapShape(map);
    await validateAgainstPdf(map, officialPdf);
    // Read through a Map rather than by index: `Record<string, ...>` types every
    // lookup as present, and this whole function turns on telling an absent key
    // from an empty one. The Map's `get` returns `... | undefined`, so the
    // compiler agrees with what actually happens at runtime.
    const supplied = new Map<string, StatutoryValue>(Object.entries(values));
    checkValuesAgainstMap(map, supplied, signatures);

    // `Fastest` skips pdf-lib's incremental yielding during parse. It is a
    // scheduling knob, not a fidelity one: measured against the published TREC
    // bytes (620,865 B, 245 AcroForm fields) it halves the parse -- 125 ms to
    // 55 ms in Node -- and the saved document is BYTE-IDENTICAL to the default
    // parse's, checked with pdf-lib's own timestamps zeroed so the comparison
    // was of content rather than of the clock.
    const doc = await PDFDocument.load(officialPdf, { parseSpeed: ParseSpeeds.Fastest });
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
        // BEFORE the value lookup: a signature resolves by reference and never
        // arrives through `values`, so a check after it would find nothing to
        // skip and skip anyway — an empty signature box on a document that
        // prints and looks complete. See `drawSignature` for the box.
        if (mapping.kind === 'signature' || signatures.has(mapping.ourField)) {
            await drawSignature(doc, pages, mapping, signatures.get(mapping.ourField));
            continue;
        }

        const value = supplied.get(mapping.ourField);
        if (value === undefined) continue;

        if (mapping.kind === 'acroform') {
            setTextField(doc, mapping, oneAnswer(value, mapping.ourField), await measuringFont());
            continue;
        }
        if (mapping.kind === 'acroform_checkbox') {
            // Ticked only where the answer names it. A box the answer did not
            // choose is LEFT AS PUBLISHED rather than actively cleared: this
            // writes an answer onto a form, and unticking a box nobody asked
            // about would be an answer of our own.
            if (answerNames(value, mapping.whenValue)) checkBoxField(doc, mapping).check();
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

/**
 * One named checkbox widget, refusing rather than guessing at any other kind.
 *
 * The mirror of `setTextField`'s refusal, and for the same reason: pdf-lib's
 * getters are typed by the caller's expectation, and a name that resolves to a
 * field of another kind would otherwise be set through an API that does not fit
 * it — or silently not set at all.
 */
function checkBoxField(
    doc: PDFDocument,
    mapping: Extract<FieldMapping, { kind: 'acroform_checkbox' }>,
): PDFCheckBox {
    try {
        return doc.getForm().getCheckBox(mapping.pdfField);
    } catch (cause) {
        throw new Error(
            `statutory render: "${mapping.pdfField}" is not a checkbox on this form — an `
            + 'acroform_checkbox mapping ticks a real widget, and a field of another kind '
            + 'needs the mapping kind that matches it',
            { cause },
        );
    }
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
