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
import { utcMidnightOf } from './inspection-date';
import type { FieldMapping } from './field-map';

/** The parts of a value an overlay may draw on its own. Closed on purpose. */
export type ValuePart = 'date_month' | 'date_day' | 'date_year';

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
    for (const m of partedOverlays(mappings)) {
        const value = values.get(m.ourField);
        // Absent was judged against `requiredFields`; an EMPTY STRING is an
        // explicit answer of "nothing" and leaves every blank empty, exactly as
        // an unparted overlay does. Refusing it would turn "the inspector had no
        // permit date" into a document that cannot be produced at all.
        if (value === undefined || value === '') continue;
        try {
            partOfValue(value, m.part, m.ourField);
        } catch (cause) {
            problems.push(cause instanceof Error ? cause.message : String(cause));
        }
    }
    if (problems.length > 0) {
        fail(`${problems.length} value(s) cannot be drawn in parts:\n`
            + problems.map((p) => `  - ${p.replace(/^statutory render: /, '')}`).join('\n'));
    }
}
