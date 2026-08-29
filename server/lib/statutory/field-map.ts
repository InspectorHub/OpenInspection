/**
 * The map from our fields onto ONE revision of an authority's PDF — and the
 * rule that it is never inherited by the next revision.
 *
 * ── Why this cannot be generated ────────────────────────────────────────────
 * Official forms arrive in three shapes and none of them is self-describing:
 *
 *   1. A fillable form whose field names carry meaning (`Owner Name`). Rare, and
 *      the examples measured were the withdrawn revisions.
 *   2. A fillable form whose field names carry none — runs of `Text1`…`Text66`
 *      with a number missing from the middle, bare digits, and generated
 *      subform paths. Nothing in the file says which of them is the client's
 *      name, and nothing groups the four boxes of a four-way rating: that
 *      grouping is visual only.
 *   3. A form with no fillable anything: no `/AcroForm`, no widgets, no
 *      annotations. A word processor document printed to PDF. Every value on
 *      one of these has to be drawn at a measured coordinate.
 *
 * Shape 2 is the dangerous one, not shape 3. Shape 3 fails immediately and
 * visibly. Shape 2 fills the wrong box, quietly, on a document somebody files
 * with a government agency.
 *
 * ── The hash is the mechanism, not the paperwork ────────────────────────────
 * Field names in these files are typed by hand by whoever produced them, and one
 * real form carries a misspelled name. A later revision that corrects the
 * spelling does not break a map inherited from the earlier revision — it moves
 * content into a different box and raises NOTHING. So a map names the sha256 of
 * the exact bytes it was authored against, every check compares against that
 * hash, and a map can never silently follow a form to its next revision.
 *
 * ⚠️ WHAT `checkedBy` / `checkedAt` PROVE, AND WHAT THEY DO NOT. They record
 * that a person put their name to this map on a date. Nothing in this file, and
 * nothing in the gate that reads it, can establish that they opened the form and
 * looked at it. That limit cannot be closed in code; it is stated here so a
 * green check is not read as more than it is.
 */
import { PDFDocument } from 'pdf-lib';
import { validateNoDuplicateTargets } from './targets';
import {
    refusePartsThatCannotFitTheirDigits, validatePartMappings, type ValuePart,
} from './value-parts';

/**
 * One answer, as it arrives from the inspection.
 *
 * A STRING is one answer: text for a blank, or the one option a single-choice
 * question chose. An ARRAY is several options of ONE question — the shape a
 * form's multi-select boxes actually take, and the reason it exists: counted on
 * the three forms measured, `photo_requirements_included` prints 6 boxes,
 * `electrical.hazards_present` 13, `electrical.wiring_types` 8,
 * `plumbing.pipe_types` 8, `roof[*].damage_signs` 8 and the 1802's
 * `roof_covering_types` 7, and every one of them is plainly multi-select on the
 * page. A single string could ever mark one of them.
 *
 * ⚠️ AN EMPTY ARRAY IS REFUSED, and this is a decision rather than an oversight.
 * "None of these boxes" already has a spelling here — the empty string, which
 * every layer treats as an explicit answer of nothing — and one answer with two
 * spellings is a permanent question at every read site about which one a given
 * producer emits. An empty array is also exactly what a collector that resolved
 * nothing produces, and on a statutory form a question with no box ticked reads
 * identically to a question nobody was asked.
 */
export type StatutoryValue = string | readonly string[];

/**
 * One value's route onto the page.
 *
 * `acroform` — set a named form field. Only possible where the form has fields.
 * `overlay`  — draw the text at a measured coordinate. The only route for a
 *              form with no fields, and it has nothing that can tell you at
 *              runtime that the coordinate is wrong, which is why overlay
 *              coordinates need a regression test rather than a review.
 *              `maxHeight` and `minSize` are what stop a long answer running
 *              down over the row beneath it: the room measured below the
 *              baseline, and how small the text may shrink before the value is
 *              refused instead. Both are optional and a map that declares
 *              neither behaves exactly as it did before they existed — most
 *              rows on these forms hold one line, so the pair is worth
 *              declaring wherever anyone has measured.
 * `checkbox` — draw a mark at a coordinate when our answer names `whenValue`.
 *              Several of these share one `ourField` on purpose: that is how a
 *              multiple-choice answer maps onto boxes the file does not group.
 *              A string answer names one of them; an array names every box it
 *              contains, which is what a multi-select question needs.
 *              ⚠️ It DRAWS. On a form whose boxes are real widgets that is the
 *              wrong route — see `acroform_checkbox` — because the printed page
 *              comes out right and the field data still reads unticked.
 * `acroform_checkbox` — SET a named `/Btn` widget when our answer names
 *              `whenValue`. The mirror of `acroform` for the other kind of
 *              field, and the only route that puts the answer in the DOCUMENT
 *              rather than only on the page. Measured on TX TREC REI 7-6: 245
 *              fields, 81 text and 164 genuine checkbox widgets. Nothing is
 *              drawn, so the page's own content stream is untouched, and a
 *              widget the answer did not choose is left exactly as published
 *              rather than actively cleared.
 * `signature` — draw a stored signature image inside a measured box. `scope`
 *              names WHICH PART of the form this signature stands behind: the
 *              Citizens four-point form lets a trade-specific licensee sign only
 *              their own section, so one form can carry several signatures that
 *              each answer for a different part, and a single form-wide role
 *              cannot say that. Use `whole_form` when the form has one signer.
 */
export type FieldMapping =
    | { kind: 'acroform'; ourField: string; pdfField: string }
    | { kind: 'overlay'; ourField: string; page: number; x: number; y: number; size: number;
        maxWidth?: number;
        /**
         * Room measured below this baseline, in points. ABSENT MEANS UNBOUNDED,
         * which is what every map authored before this field existed says.
         */
        maxHeight?: number;
        /**
         * How small the text may shrink before the value is refused rather than
         * made unreadable. Absent means no shrinking at all: a floor nobody
         * measured is not a floor.
         */
        minSize?: number;
        /**
         * Draw only THIS PART of the value. Absent means the whole value, which
         * is what every map authored before this field existed says.
         *
         * It exists because some forms print a value's separators themselves.
         * Measured on FL OIR-B1-1802: a date is three blanks with the form's own
         * slashes in the two 2.8pt gaps between them, and one overlay covering
         * all three writes the year across the wrong blank while leaving the
         * year's own blank empty. Three overlays, one per part, is the only way
         * to fill a form like that from a single value — and entry stays a
         * single date box, which is the whole point.
         */
        part?: ValuePart }
    | { kind: 'checkbox'; ourField: string; whenValue: string; page: number; x: number; y: number; size?: number }
    | { kind: 'acroform_checkbox'; ourField: string; whenValue: string; pdfField: string }
    | { kind: 'signature'; ourField: string; scope: string;
        page: number; x: number; y: number; width: number; height: number };

/** The complete map for one (formId, version), bound to one `sourceHash`. */
export interface FieldMap {
    formId: string;
    version: string;
    /** The sha256 of the published bytes this map was authored against. */
    sourceHash: string;
    /** Who checked this map against the form. See the header for what this does not prove. */
    checkedBy: string;
    /** When they checked it, epoch ms. */
    checkedAt: number;
    /**
     * Our field names that MUST be mapped, and — at render time — must be
     * supplied. A required field left out of the values is refused rather than
     * rendered blank: a form nobody filled must never come out looking like one
     * somebody filled and left empty.
     */
    requiredFields: readonly string[];
    mappings: readonly FieldMapping[];
}

/** sha256 of the exact bytes, lowercase hex. Web Crypto — no Node APIs. */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/** Shape of the version a map claims to target — the fields this file compares. */
interface VersionIdentity {
    formId: string;
    version: string;
    sourceHash: string;
}

function fail(reason: string): never {
    throw new Error(`statutory field map: ${reason}`);
}

/**
 * Check a map against the version it claims to target, without reading the PDF.
 *
 * Throws on the first problem, naming it. This is the half that can run
 * anywhere; `validateAgainstPdf` is the half that needs the bytes.
 */
export function validateFieldMap(map: FieldMap, version: VersionIdentity): void {
    if (map.formId !== version.formId) {
        fail(`map is for form "${map.formId}" but was checked against "${version.formId}"`);
    }
    if (map.version !== version.version) {
        fail(`map is for revision "${map.version}" but was checked against "${version.version}" — `
            + 'a map is authored per revision and is never inherited');
    }
    if (map.sourceHash !== version.sourceHash) {
        fail(`sourceHash mismatch: the map was authored against ${map.sourceHash} and the `
            + `revision publishes ${version.sourceHash}. The map must be re-authored against the `
            + 'published bytes, never carried over.');
    }
    validateFieldMapShape(map);
}

/**
 * The half of the check that needs only the map: it is internally consistent and
 * complete.
 *
 * Separate from the identity comparison above because the renderer has a map and
 * the published bytes but no version row in hand — and a map that contradicts
 * itself must be refused there too, rather than half-applied.
 */
export function validateFieldMapShape(map: FieldMap): void {
    if (map.checkedBy.trim() === '') {
        fail('checkedBy is empty — a map with nobody attached to it has not been checked');
    }
    if (!Number.isFinite(map.checkedAt) || map.checkedAt <= 0) {
        fail('checkedAt is not a date — a check with no date cannot be aged against a revision');
    }
    if (map.mappings.length === 0) {
        fail('no mappings — an empty map validates against every PDF ever published and renders a blank form');
    }

    // The part rules run FIRST because they are the more specific ones. A
    // parted overlay missing a bound trips `validateOverlayFit` too, and that
    // message names the field but not which of its three printed blanks —
    // which is the whole thing the reader needs when one field has three.
    validatePartMappings(map.mappings);
    validateMappingShapes(map.mappings);
    validateNoDuplicateTargets(map.mappings);

    const mapped = new Set(map.mappings.map((m) => m.ourField));
    const missing = map.requiredFields.filter((f) => !mapped.has(f));
    if (missing.length > 0) {
        fail(`${missing.length} required field(s) have no mapping: ${missing.join(', ')}`);
    }
}

/** Per-mapping arithmetic: a coordinate or a size that cannot draw anything. */
function validateMappingShapes(mappings: readonly FieldMapping[]): void {
    for (const m of mappings) {
        if (m.ourField.trim() === '') fail('a mapping has an empty ourField');
        if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') {
            // Both routes into a fillable form are addressed by NAME and have no
            // geometry of their own; the widget's rectangle is the form's.
            if (m.pdfField.trim() === '') fail(`"${m.ourField}" maps to an empty pdfField name`);
            if (m.kind === 'acroform_checkbox' && m.whenValue.trim() === '') {
                fail(`checkbox for "${m.ourField}" has an empty whenValue`);
            }
            continue;
        }
        if (!Number.isInteger(m.page) || m.page < 0) {
            fail(`"${m.ourField}" names page ${m.page}; a page index is a whole number from 0`);
        }
        if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || m.x < 0 || m.y < 0) {
            fail(`"${m.ourField}" has an off-page coordinate (${m.x}, ${m.y})`);
        }
        if (m.kind === 'overlay') {
            // Size 0 draws nothing while every count of "values written" still
            // includes it — the value is absent from the form and present in the
            // arithmetic.
            if (!Number.isFinite(m.size) || m.size <= 0) {
                fail(`"${m.ourField}" has size ${m.size}; text drawn at that size is not on the form`);
            }
            if (m.maxWidth !== undefined && (!Number.isFinite(m.maxWidth) || m.maxWidth <= 0)) {
                fail(`"${m.ourField}" has maxWidth ${m.maxWidth}`);
            }
            validateOverlayFit(m);
        } else if (m.kind === 'signature') {
            if (!(m.width > 0) || !(m.height > 0)) {
                fail(`signature "${m.ourField}" has width ${m.width} and height `
                    + `${m.height}; a signature needs a box with area, and a zero one `
                    + 'renders as nothing at all rather than as an error');
            }
            if (m.scope.trim() === '') {
                fail(`signature "${m.ourField}" declares no scope; use "whole_form" `
                    + 'when the form has a single signer');
            }
        } else {
            if (m.whenValue.trim() === '') {
                // A checkbox with no trigger value marks itself for every answer,
                // including an answer of "no".
                fail(`checkbox for "${m.ourField}" has an empty whenValue`);
            }
            if (m.size !== undefined && (!Number.isFinite(m.size) || m.size <= 0)) {
                fail(`checkbox for "${m.ourField}" has size ${m.size}; a mark that size is not on the form`);
            }
        }
    }
}

/** The `overlay` member of the union, for the checks that only concern it. */
export type OverlayMapping = Extract<FieldMapping, { kind: 'overlay' }>;

/**
 * The two optional fields that bound how much text a row may take.
 *
 * They are optional so that maps authored before they existed keep working, and
 * that is exactly why each has to be checked when it IS present: an author who
 * bothered to measure the row must not have their measurement silently ignored
 * because it was written down wrong.
 */
function validateOverlayFit(m: OverlayMapping): void {
    if (m.maxHeight !== undefined && (!Number.isFinite(m.maxHeight) || m.maxHeight <= 0)) {
        fail(`overlay "${m.ourField}" declares maxHeight ${m.maxHeight}; a row with no height `
            + 'cannot hold anything, and zero here would refuse every value rather than mean '
            + '"unbounded" — which is what leaving it out means');
    }
    if (m.minSize !== undefined
        && (!Number.isFinite(m.minSize) || m.minSize <= 0 || m.minSize > m.size)) {
        fail(`overlay "${m.ourField}" declares minSize ${m.minSize} against size ${m.size}; the `
            + 'floor is where shrinking stops, so it is never larger than the size it starts from '
            + 'and never small enough to be unreadable');
    }
    if (m.maxHeight !== undefined && m.maxWidth === undefined) {
        fail(`overlay "${m.ourField}" declares maxHeight but no maxWidth; without a width the `
            + 'text never wraps, so a height bound can never be reached and would read as a '
            + 'guarantee it does not give');
    }
    // The mirror, and the half that was actually being written. `fitOverlay`
    // returns early unless BOTH are present, so a lone maxWidth is measured by
    // nothing — not here, not in fit.ts, not at print. Measured on the Citizens
    // four-point candidate: all 48 overlays declared a width, none declared a
    // height, and no value was ever checked against one. Half a measurement
    // that reads as a bound is worse than none, because it is the reason
    // nobody looked.
    if (m.maxWidth !== undefined && m.maxHeight === undefined) {
        fail(`overlay "${m.ourField}" declares maxWidth ${m.maxWidth} but no maxHeight. `
            + 'Nothing measures the width on its own: a value too long for the blank does not '
            + 'run off the side, it wraps DOWN over the row beneath, and only a height says '
            + 'how far down is too far. Measure the room below this baseline, or declare '
            + 'neither and say in the map that this row was never measured.');
    }
}

/**
 * Check a map against the actual published bytes.
 *
 * Resolves (to `undefined`) when the map can be applied to these bytes, rejects
 * naming the first thing that cannot. The hash is checked FIRST: against the
 * wrong revision the field names may well still resolve while the layout
 * underneath has moved, so "the names matched" is not evidence of anything until
 * the bytes are known to be the right ones.
 */
export async function validateAgainstPdf(map: FieldMap, pdfBytes: Uint8Array): Promise<void> {
    const actual = await sha256Hex(pdfBytes);
    if (actual !== map.sourceHash) {
        fail(`sourceHash mismatch: these bytes hash to ${actual} and the map was authored `
            + `against ${map.sourceHash}`);
    }
    await refusePartsThatCannotFitTheirDigits(map.mappings);

    let doc: PDFDocument;
    try {
        doc = await PDFDocument.load(pdfBytes);
    } catch (cause) {
        throw new Error(
            `statutory field map: the published bytes for ${map.formId} ${map.version} are not a readable PDF`,
            { cause },
        );
    }

    const pageCount = doc.getPageCount();
    // `getForm()` on a form-less document yields an empty field list rather than
    // throwing, which is the behaviour a flat form needs: an overlay-only map
    // against a PDF with no fields is the normal case, not a degraded one.
    const names = new Set(doc.getForm().getFields().map((f) => f.getName()));

    const missingFields: string[] = [];
    const offPage: string[] = [];
    for (const m of map.mappings) {
        if (m.kind === 'acroform' || m.kind === 'acroform_checkbox') {
            if (!names.has(m.pdfField)) missingFields.push(`${m.ourField} -> "${m.pdfField}"`);
        } else if (m.page >= pageCount) {
            offPage.push(`${m.ourField} -> page ${m.page}`);
        }
    }

    if (missingFields.length > 0) {
        fail(`${missingFields.length} mapping(s) name a field this PDF does not have: `
            + `${missingFields.join(', ')} (the PDF has ${names.size} field(s))`);
    }
    if (offPage.length > 0) {
        fail(`${offPage.length} mapping(s) fall outside the document, which has ${pageCount} page(s): `
            + offPage.join(', '));
    }
}
