/**
 * Drawing ONE PART of a value, because the form printed the separators itself.
 *
 * ── The failure this exists to stop ─────────────────────────────────────────
 * Florida's OIR-B1-1802 prints a date as three separate blanks with its OWN
 * slashes printed in the gaps between them. Measured on page 0: MM occupies
 * 472.20–492.30, the form's slash 492.36–495.13, DD 495.12–515.10, its second
 * slash 515.16–517.93, YYYY 517.80–557.81.
 *
 * One overlay drawing `03/15/2026` at 9pt Helvetica from x=473.7 is 45.0pt wide
 * and ends at 518.736. So the year sits across the DD blank and the second gap,
 * our slashes are drawn beside the form's, and 39.08 of the year blank's 40.02
 * points stay empty. Nothing raises. The page renders, prints and files, and
 * only the content is wrong -- on a document that goes to an insurer and a
 * state regulator.
 *
 * ── Why a closed set of named parts, and not a slicer ───────────────────────
 * A general `slice: { offset, length }` does this job and also does it wrong
 * silently: (0,2) of `2026-03-15` is `20`, which is a perfectly month-shaped
 * string, lands in the month blank, and is contradicted by nothing. An offset is
 * also welded to one input format, so the day the source format moves it cuts a
 * different substring rather than failing. A format string (`'MM'`) is the same
 * problem with a friendlier face: it is an open string, so `'mm'` and `'MMM'`
 * compile, and the entire observable result of that typo is a BLANK BOX.
 *
 * A closed union fails in the compiler, where the mistake is cheap.
 *
 * ── Why only `YYYY-MM-DD` ───────────────────────────────────────────────────
 * Measured 2026-08-29, every source that can reach a part yields it:
 * `inspections.date` is TEXT and `produce.service.ts` runs `utcMidnightOf` over
 * it before anything else, so a non-ISO inspection date already refuses the
 * whole production; a `date` item and a `date` attribute are both entered
 * through `<input type="date">`.
 *
 * So a slashed string arriving here is EVIDENCE -- that the binding points at a
 * free-text item. Parsing it would make one document right and hide the binding;
 * refusing sends the person to the thing that makes every future inspection
 * right. Nothing here can decide whether a hand-typed `04/03/2026` is April 3rd
 * or the 4th of March either: the form prints `(MM/DD/YYYY)` over its own boxes,
 * and says nothing about the text box in our editor.
 *
 * ⚠️ This strictness is affordable only now. `PUBLISHED_FORM_VERSIONS` and
 * `FIELD_MAPS` are both `[]`, so no workflow breaks. Loosening later is
 * possible; tightening later is not.
 *
 * `import type` from `field-map.ts` is erased at build time, so the only real
 * module edge is field-map -> here. There is no cycle.
 */
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { utcMidnightOf } from './inspection-date';
import type { FieldMapping } from './field-map';

/** The parts of a value an overlay may draw on its own. Closed on purpose. */
export type ValuePart = 'date_month' | 'date_day' | 'date_year';

/**
 * The whole family. A form that prints three blanks needs three overlays, so a
 * map that declares one of these must declare all of them -- see
 * `validatePartMappings`.
 *
 * There is deliberately no `date_year_2` for a form printing `__/__/__`. None of
 * the three forms measured prints one, and a member that can never resolve is a
 * blank box on an authority's form. Adding it later also means deciding where
 * the century comes from, which is a decision rather than an enum value.
 */
const DATE_PARTS: readonly ValuePart[] = ['date_month', 'date_day', 'date_year'];

/** Which capture group of `CALENDAR_DAY` each part takes. */
const GROUP: Record<ValuePart, 1 | 2 | 3> = {
    date_year: 1,
    date_month: 2,
    date_day: 3,
};

/** How many digits each part draws. Fixed, which is what makes a map checkable. */
const DIGITS: Record<ValuePart, number> = {
    date_month: 2,
    date_day: 2,
    date_year: 4,
};

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * The prefix names the RENDER, not this module, for the same reason `fit.ts`
 * does: every one of these reaches somebody as "the form would not come out
 * right", and naming a helper would tell them where the code lives instead of
 * what happened to their document.
 */
function fail(reason: string): never {
    throw new Error(`statutory render: ${reason}`);
}

/** How wide this part is drawn, in digits. */
export function digitsInPart(part: ValuePart): number {
    return DIGITS[part];
}

/**
 * The one part of `value` this overlay draws, or a refusal.
 *
 * @param ourField named in every message, because it is what the person fixing
 *   the template has to search for.
 */
export function partOfValue(value: string, part: ValuePart, ourField: string): string {
    const parsed = CALENDAR_DAY.exec(value);
    if (parsed === null) {
        fail(`"${ourField}" is drawn as a date part (${part}) and received "${value}", which is `
            + 'not a YYYY-MM-DD calendar day. Bind this field to a date item — a free-text item '
            + 'cannot promise the form a date, and this box is printed as separate blanks that '
            + 'each take one part of one.');
    }
    // The "is this a real day" test is NOT reimplemented here. Two parsers is
    // how one of them ends up lenient, and a rolled date (2026-02-30 -> March
    // 2nd) crosses a revision cutover and prints the wrong official document.
    // It is re-thrown rather than propagated because `utcMidnightOf` cannot know
    // which box on which form refused, and that is the sentence a person acts on.
    try {
        utcMidnightOf(value);
    } catch {
        fail(`"${ourField}" is drawn as a date part (${part}) and received "${value}", which is `
            + 'not a day that exists.');
    }
    return parsed[GROUP[part]];
}

/** One parted overlay, reduced to the fields every rule below reads. */
interface PartedOverlay {
    ourField: string;
    part: ValuePart;
    size: number;
    maxWidth: number | undefined;
    maxHeight: number | undefined;
    minSize: number | undefined;
}

/** Every overlay in a map that draws a part, with its `ourField`. */
function partedOverlays(mappings: readonly FieldMapping[]): PartedOverlay[] {
    const out: PartedOverlay[] = [];
    for (const m of mappings) {
        if (m.kind === 'overlay' && m.part !== undefined) {
            out.push({
                ourField: m.ourField, part: m.part, size: m.size,
                maxWidth: m.maxWidth, maxHeight: m.maxHeight, minSize: m.minSize,
            });
        }
    }
    return out;
}

/**
 * The shape rules a parted overlay has to satisfy, none of which need a PDF.
 *
 * These live here rather than in `field-map.ts` because that file is close to
 * its 400 permitted lines and `lint:filesize` is a ratchet, not a suggestion.
 * The split is also the right one on its own terms: field-map.ts owns the map's
 * identity and its arithmetic, and this owns what a part means.
 */
export function validatePartMappings(mappings: readonly FieldMapping[]): void {
    const declared = new Map<string, Set<ValuePart>>();

    for (const m of partedOverlays(mappings)) {
        const known = declared.get(m.ourField) ?? new Set<ValuePart>();
        known.add(m.part);
        declared.set(m.ourField, known);

        // `fitOverlay` returns early unless BOTH bounds are present, and
        // pdf-lib's own maxWidth breaks only at spaces -- which a run of digits
        // does not have. So a part missing either bound is drawn against nothing
        // at all, and runs off the side of its blank without raising.
        if (m.maxWidth === undefined || m.maxHeight === undefined) {
            fail(`overlay "${m.ourField}" (${m.part}) must declare both maxWidth and maxHeight; `
                + 'a part is drawn into one printed blank, and nothing measures it unless both '
                + 'bounds are given — a digit run never wraps, so it would simply run off the '
                + 'side of that blank in silence');
        }

        // A part is two digits or four, and Helvetica digits are all one width,
        // so shrinking can only ever rescue a maxWidth that was measured too
        // small. It would then shrink this part and not its siblings, printing a
        // date in two sizes -- and hiding the mis-measurement behind it.
        if (m.minSize !== undefined) {
            fail(`overlay "${m.ourField}" (${m.part}) declares minSize ${m.minSize}; a part has a `
                + 'fixed width, so a floor can only fire when the blank was measured wrong, and '
                + 'shrinking one part of a date away from the other two hides that rather than '
                + 'reporting it');
        }
    }

    for (const [ourField, known] of declared) {
        const missing = DATE_PARTS.filter((p) => !known.has(p));
        if (missing.length > 0) {
            fail(`"${ourField}" is drawn in parts but declares no ${missing.join(', ')}; the form `
                + 'prints a blank for each part, and one left unwritten reads as a box the '
                + 'inspector skipped. Declare every part, or draw the value whole.');
        }
    }
}

/**
 * Every value drawn in parts is readable as one, reported all at once.
 *
 * Called from `checkValuesAgainstMap` BEFORE the document is loaded. The rule
 * itself is `partOfValue` and this is a second CALL of it, never a second copy:
 * a half-implemented duplicate is exactly how the next person comes to fix only
 * one of them. What this adds is timing and breadth -- a person with four broken
 * bindings is told about four, not about the first.
 */
export function refuseUnreadableParts(
    mappings: readonly FieldMapping[],
    values: ReadonlyMap<string, string>,
): void {
    const problems: string[] = [];
    // One per FIELD, not one per part: a value that cannot be read is unreadable
    // in all three of its blanks, and saying so three times would make the count
    // in the message disagree with the number of bindings to go and fix.
    const reported = new Set<string>();
    for (const m of partedOverlays(mappings)) {
        if (reported.has(m.ourField)) continue;
        const value = values.get(m.ourField);
        // Absent was judged against `requiredFields`; an EMPTY STRING is an
        // explicit answer of "nothing" and leaves every blank empty, exactly as
        // an unparted overlay does. Refusing it would turn "the inspector had no
        // permit date" into a document that cannot be produced at all.
        if (value === undefined || value === '') continue;
        try {
            partOfValue(value, m.part, m.ourField);
        } catch (cause) {
            reported.add(m.ourField);
            problems.push(cause instanceof Error ? cause.message : String(cause));
        }
    }
    if (problems.length > 0) {
        fail(`${problems.length} value(s) cannot be drawn in parts:\n`
            + problems.map((p) => `  - ${p.replace(/^statutory render: /, '')}`).join('\n'));
    }
}

/**
 * A part's blank holds the digits that part draws — checked without any data.
 *
 * ── Why this is exact rather than an estimate ───────────────────────────────
 * Every Helvetica digit advances 556/1000 of the em, so `'0'.repeat(n)` is not a
 * worst case, it is THE case. A part is always two digits or four. The map
 * therefore already contains everything needed to know how wide the text will
 * be, which no other overlay can say.
 *
 * ── Why it lives on the async half ──────────────────────────────────────────
 * It needs a FONT, and embedding one is the same class of cost as loading the
 * document: it cannot happen in the synchronous half. The font is embedded in a
 * scratch document rather than in the agency's, exactly as `render.ts` does for
 * its ruler — needing to measure is not grounds for putting an object of ours
 * into a document we otherwise leave alone.
 *
 * ⚠️ WHAT THIS DOES NOT REACH. `fieldMapFor()` calls only the synchronous
 * `validateFieldMap`, so this does not run per lookup in production; the
 * backstop there is the `fitOverlay` refusal at render time. This one runs where
 * a map is authored and in CI, which is where a mis-measured blank is cheap.
 *
 * ⚠️ AND WHAT IT CANNOT SEE AT ALL. It proves the blank you measured holds these
 * digits. It cannot prove you measured the right blank — that failure renders,
 * prints and files with only the content wrong, and only a person reading the
 * form catches it.
 */
export async function refusePartsThatCannotFitTheirDigits(
    mappings: readonly FieldMapping[],
): Promise<void> {
    const parted = partedOverlays(mappings);
    if (parted.length === 0) return;

    const ruler = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    const tooNarrow: string[] = [];
    for (const m of parted) {
        // `validatePartMappings` already refused a part with no maxWidth; this
        // guard keeps the type honest rather than restating that rule.
        if (m.maxWidth === undefined) continue;
        const widest = ruler.widthOfTextAtSize('0'.repeat(digitsInPart(m.part)), m.size);
        if (widest > m.maxWidth) {
            tooNarrow.push(`"${m.ourField}" (${m.part}) draws ${digitsInPart(m.part)} digits at `
                + `size ${m.size}, which is ${widest.toFixed(3)}pt, into a blank measured `
                + `${m.maxWidth}pt`);
        }
    }
    if (tooNarrow.length > 0) {
        fail(`${tooNarrow.length} part(s) do not fit the blank measured for them:\n`
            + tooNarrow.map((t) => `  - ${t}`).join('\n')
            + '\n  These blanks are cut for the form\'s own typeface. Helvetica digits are wider '
            + 'than Times ones by about 11%, so a blank that holds four 9pt Times characters '
            + 'holds four Helvetica ones only at 8pt.');
    }
}
