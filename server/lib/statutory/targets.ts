/**
 * Two mappings must not write to the same PLACE on the form.
 *
 * ── Why the key is the target and not the field ─────────────────────────────
 * This rule used to key on `ourField`: a second mapping of one value was
 * refused whatever it pointed at. Measured on Florida's OIR-B1-1802, that is
 * wrong in both directions at once.
 *
 * It REFUSES a form that is asking twice. The 1802 prints the inspector's
 * initials and the property address in the footer of EVERY ONE of its six
 * pages, at six different coordinates. Six mappings of one value is what that
 * form is, and the only way to satisfy a field-keyed rule would have been to
 * invent six field names for one answer — which puts the same string into an
 * inspection six times and gives five of them nothing to keep them in step.
 *
 * And it MISSES the failure it was written for. Its own stated reason was "a
 * coordinate that was pasted and never re-measured" — and a paste that also
 * changed `ourField` sails straight through it, drawing two DIFFERENT values at
 * one coordinate. One is painted over the other, on a document somebody files
 * with a government agency, and nothing anywhere says so.
 *
 * So a target is claimed once: a `pdfField` name, or a (page, x, y). A repeated
 * field is left alone, because a repeated field is what these forms do.
 *
 * ⚠️ THE COORDINATE COMPARISON IS EXACT, and that is a limit rather than a
 * choice of tolerance. It catches the paste, which is byte-identical. It does
 * not catch two boxes measured 0.4pt apart that are physically the same box —
 * nothing here can tell that from two genuinely adjacent blanks, because the
 * blanks on these forms are 7pt across and sit 15pt apart. That one is a
 * person's job, holding the render beside the form.
 *
 * ── What did NOT move here, and why ─────────────────────────────────────────
 * Three rules below are about a FIELD contradicting itself rather than about
 * where it lands, so the change above does not reach them. In particular, two
 * boxes carrying one answer to one question stays refused: a mapping that was
 * pasted, re-measured, and had its `whenValue` left alone ticks two boxes for
 * one answer at two perfectly good coordinates, which the target key cannot see.
 *
 * ── Why this is not in `field-map.ts` ───────────────────────────────────────
 * The same reason `value-parts.ts` is not: that file is close to its 400
 * permitted lines and `lint:filesize` is a ratchet, not a suggestion. The split
 * is also right on its own terms — field-map.ts owns a map's identity and its
 * per-mapping arithmetic, and this owns what it means for two of them to
 * collide.
 */
import type { FieldMapping } from './field-map';

function fail(reason: string): never {
    throw new Error(`statutory field map: ${reason}`);
}

/** One box that carries one answer to one question, drawn or set. */
type AnswerBox = Extract<FieldMapping, { kind: 'checkbox' | 'acroform_checkbox' }>;

/**
 * The mapping kinds that answer a multiple-choice question by marking a box.
 *
 * Two of them, because these forms come in two shapes: a box that is a drawing
 * on the page and a box that is a widget in the file. Every rule below is about
 * the ANSWER, so both belong to it.
 */
function isAnswerBox(m: FieldMapping): m is AnswerBox {
    return m.kind === 'checkbox' || m.kind === 'acroform_checkbox';
}

/** The mapping kinds that put a whole value somewhere, one value per place. */
function isSingleValue(m: FieldMapping): boolean {
    return m.kind === 'overlay' || m.kind === 'acroform';
}

/**
 * WHERE this mapping writes, as a key.
 *
 * A form field is named; everything else is drawn, and a drawn mapping's place
 * is its origin on its page. A signature's box is keyed by its origin too — a
 * signature anchored where a value is already drawn is the same collision.
 */
function targetKey(m: FieldMapping): string {
    if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') {
        return `field\u0000${m.pdfField}`;
    }
    return `page ${m.page}\u0000${m.x},${m.y}`;
}

/** How a refusal names the place, in the words somebody would use to find it. */
function targetLabel(m: FieldMapping): string {
    if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') {
        return `the form field "${m.pdfField}"`;
    }
    return `(${m.x}, ${m.y}) on page ${m.page}`;
}

/** How a refusal names the mapping, including which answer or part it carries. */
function mappingLabel(m: FieldMapping): string {
    if (isAnswerBox(m)) return `"${m.ourField}" = "${m.whenValue}"`;
    if (m.kind === 'overlay' && m.part !== undefined) return `"${m.ourField}" (${m.part})`;
    return `"${m.ourField}"`;
}

/** Nothing writes where something already writes. */
function refuseCollidingTargets(mappings: readonly FieldMapping[]): void {
    const claimed = new Map<string, FieldMapping>();
    for (const m of mappings) {
        const key = targetKey(m);
        const first = claimed.get(key);
        if (first !== undefined) {
            fail(`two mappings write to ${targetLabel(m)}: ${mappingLabel(first)} and `
                + `${mappingLabel(m)}. One of them is put on the form over the other, and the `
                + 'document that comes out looks filled either way. A value the form prints in '
                + 'several places needs several mappings with several coordinates, never two at one.');
        }
        claimed.set(key, m);
    }
}

/** One question, one box per answer. */
function refuseRepeatedAnswers(mappings: readonly FieldMapping[]): void {
    const seen = new Set<string>();
    for (const m of mappings) {
        if (!isAnswerBox(m)) continue;
        // Joined on a character neither half can contain, not on a space: a
        // field named "roof age" answered "years" and a field named "roof"
        // answered "age years" are different questions with the same joined key.
        const key = `${m.ourField}\u0000${m.whenValue}`;
        if (seen.has(key)) {
            fail(`"${m.ourField}" has two boxes for the value "${m.whenValue}"; a mapping that `
                + 'was copied and re-measured, and whose whenValue was left alone, marks both '
                + 'of them for one answer');
        }
        seen.add(key);
    }
}

/**
 * A field is one shape: a set of boxes, a whole value, or a value in parts.
 *
 * These are about the field contradicting itself rather than about where it
 * lands, so keying the rule above on the target does not reach them. A field
 * drawn both in parts and whole writes the whole value across the parts, which
 * is the failure the parts exist to prevent; a field that is both a checkbox and
 * a single value answers one question two incompatible ways.
 */
function refuseContradictoryShapes(mappings: readonly FieldMapping[]): void {
    const wholeValue = new Set<string>();
    const parted = new Set<string>();
    const boxed = new Set<string>();
    for (const m of mappings) {
        if (isAnswerBox(m)) boxed.add(m.ourField);
        else if (isSingleValue(m)) {
            const part = m.kind === 'overlay' ? m.part : undefined;
            (part === undefined ? wholeValue : parted).add(m.ourField);
        }
    }

    for (const field of parted) {
        if (wholeValue.has(field)) {
            fail(`"${field}" is drawn both in parts and as a whole value; the whole-value `
                + 'overlay is written across the parts, which is the failure the parts exist '
                + 'to prevent');
        }
    }
    for (const field of boxed) {
        if (wholeValue.has(field) || parted.has(field)) {
            fail(`"${field}" is mapped both as a checkbox and as a single value`);
        }
    }
}

/** Every rule about two mappings meeting, in the order that reads best. */
export function validateNoDuplicateTargets(mappings: readonly FieldMapping[]): void {
    refuseCollidingTargets(mappings);
    refuseRepeatedAnswers(mappings);
    refuseContradictoryShapes(mappings);
}
