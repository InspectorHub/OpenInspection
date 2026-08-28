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

/**
 * One value's route onto the page.
 *
 * `acroform` — set a named form field. Only possible where the form has fields.
 * `overlay`  — draw the text at a measured coordinate. The only route for a
 *              form with no fields, and it has nothing that can tell you at
 *              runtime that the coordinate is wrong, which is why overlay
 *              coordinates need a regression test rather than a review.
 * `checkbox` — draw a mark at a coordinate when our value equals `whenValue`.
 *              Several of these share one `ourField` on purpose: that is how a
 *              multiple-choice answer maps onto boxes the file does not group.
 * `signature` — draw a stored signature image inside a measured box. `scope`
 *              names WHICH PART of the form this signature stands behind: the
 *              Citizens four-point form lets a trade-specific licensee sign only
 *              their own section, so one form can carry several signatures that
 *              each answer for a different part, and a single form-wide role
 *              cannot say that. Use `whole_form` when the form has one signer.
 */
export type FieldMapping =
    | { kind: 'acroform'; ourField: string; pdfField: string }
    | { kind: 'overlay'; ourField: string; page: number; x: number; y: number; size: number; maxWidth?: number }
    | { kind: 'checkbox'; ourField: string; whenValue: string; page: number; x: number; y: number; size?: number }
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
        if (m.kind === 'acroform') {
            if (m.pdfField.trim() === '') fail(`"${m.ourField}" maps to an empty pdfField name`);
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

/**
 * Two mappings must not compete for one value.
 *
 * A repeated `ourField` is legitimate for checkboxes and only for checkboxes —
 * that is a multiple-choice answer spread across boxes the file does not group.
 * Anywhere else it writes one value into two places, and the second one is
 * always the one nobody meant. Two checkboxes sharing a field AND a value is a
 * coordinate that was pasted and never re-measured.
 */
function validateNoDuplicateTargets(mappings: readonly FieldMapping[]): void {
    const singleValue = new Set<string>();
    const checkboxAnswers = new Set<string>();
    for (const m of mappings) {
        if (m.kind === 'checkbox') {
            const key = `${m.ourField} ${m.whenValue}`;
            if (checkboxAnswers.has(key)) {
                fail(`"${m.ourField}" has two checkboxes for the value "${m.whenValue}"`);
            }
            checkboxAnswers.add(key);
            continue;
        }
        if (singleValue.has(m.ourField)) {
            fail(`"${m.ourField}" is mapped twice; only a checkbox may repeat a field`);
        }
        singleValue.add(m.ourField);
    }
    for (const m of mappings) {
        if (m.kind === 'checkbox' && singleValue.has(m.ourField)) {
            fail(`"${m.ourField}" is mapped both as a checkbox and as a single value`);
        }
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
        if (m.kind === 'acroform') {
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
