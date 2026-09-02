/**
 * A field map is authored against ONE revision's bytes and may never be
 * inherited by the next.
 *
 * The failure this prevents does not raise anything at runtime. Field names in
 * these PDFs are typed by hand by whoever produced them: runs of `Text1`…`Text66`
 * with one number missing, bare digits, and — in a real example — one name
 * simply misspelled. A later revision that "fixes" the spelling does not break a
 * map inherited from the previous revision; it moves content into a different
 * box on a statutory document, and nothing anywhere says so. The sha256 of the
 * exact published bytes is what makes inheritance impossible.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import {
    validateFieldMap,
    validateFieldMapShape,
    validateAgainstPdf,
    type FieldMap,
    type FieldMapping,
} from '../../../server/lib/statutory/field-map';
import { sha256Hex } from '../../../server/lib/sha256';
import type { StatutoryFormVersion } from '../../../server/lib/statutory/form-registry';
import { buildFieldedPdf, buildFlatPdf, type PdfFixture } from '../helpers/statutory-pdf-fixtures';

let fielded: PdfFixture;
let flat: PdfFixture;

beforeAll(async () => {
    fielded = await buildFieldedPdf();
    flat = await buildFlatPdf();
});

const VERSION = (hash: string): StatutoryFormVersion => ({
    formId: 'xx_example_form',
    formTitle: 'Yankee Flat Form',
    version: '1-0',
    effectiveFrom: Date.parse('2026-01-01T00:00:00.000Z'),
    mandatoryFrom: Date.parse('2026-01-01T00:00:00.000Z'),
    effectiveUntil: null,
    sourceUrl: 'https://example.gov/forms/example.pdf',
    sourceHash: hash,
    publishedBy: 'u1',
    publishedAt: Date.parse('2026-08-21T00:00:00.000Z'),
    withdrawn: null,
});

const MAP = (hash: string): FieldMap => ({
    formId: 'xx_example_form',
    version: '1-0',
    sourceHash: hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-21T00:00:00.000Z'),
    requiredFields: ['client.name'],
    mappings: [
        { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
        { kind: 'acroform', ourField: 'property.address', pdfField: 'Text1' },
    ],
});

describe('validateFieldMap', () => {
    it('refuses a map whose sourceHash does not match the version it targets', () => {
        expect(() => validateFieldMap({ ...MAP(fielded.hash), sourceHash: 'f'.repeat(64) }, VERSION(fielded.hash)))
            .toThrow(/sourceHash/);
    });

    it('POSITIVE CONTROL — a matching hash validates', () => {
        expect(() => validateFieldMap(MAP(fielded.hash), VERSION(fielded.hash))).not.toThrow();
    });

    it('refuses a map targeting a different revision of the same form', () => {
        // The inheritance case stated directly: same formId, next revision,
        // whoever copied the file forgot the hash is not decorative.
        const version: StatutoryFormVersion = { ...VERSION(fielded.hash), version: '1-1' };
        expect(() => validateFieldMap(MAP(fielded.hash), version)).toThrow(/1-1/);
    });

    it('refuses a map targeting a different form entirely', () => {
        const version: StatutoryFormVersion = { ...VERSION(fielded.hash), formId: 'yy_other_form' };
        expect(() => validateFieldMap(MAP(fielded.hash), version)).toThrow(/yy_other_form/);
    });

    it('requires a human check to be recorded', () => {
        expect(() => validateFieldMap({ ...MAP(fielded.hash), checkedBy: '' }, VERSION(fielded.hash)))
            .toThrow(/checkedBy/);
        expect(() => validateFieldMap({ ...MAP(fielded.hash), checkedBy: '   ' }, VERSION(fielded.hash)))
            .toThrow(/checkedBy/);
        expect(() => validateFieldMap({ ...MAP(fielded.hash), checkedAt: 0 }, VERSION(fielded.hash)))
            .toThrow(/checkedAt/);
    });

    it('refuses a map with no mappings at all', () => {
        // An empty map validates against every PDF ever published and renders a
        // blank form. It must not be the thing that passes most easily.
        expect(() => validateFieldMap({ ...MAP(fielded.hash), mappings: [] }, VERSION(fielded.hash)))
            .toThrow(/no mappings/);
    });

    it('refuses a required field that nothing maps', () => {
        expect(() => validateFieldMap(
            { ...MAP(fielded.hash), requiredFields: ['client.name', 'inspection.date'] },
            VERSION(fielded.hash),
        )).toThrow(/inspection\.date/);
    });

    it('refuses two mappings writing into one form field', () => {
        // The duplicate is the TARGET, not the field. Two values sent to one
        // widget means one of them is stored and the other is not, and the
        // document that comes out looks filled either way.
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            mappings: [
                { kind: 'acroform', ourField: 'client.name', pdfField: 'Text1' },
                { kind: 'acroform', ourField: 'property.address', pdfField: 'Text1' },
            ],
        }, VERSION(fielded.hash))).toThrow(/Text1/);
    });

    it('ALLOWS one value written into two form fields — the form asked twice', () => {
        // Measured on FL OIR-B1-1802, which prints the property address in the
        // footer of all six pages. A rule keyed on `ourField` made that
        // unmappable; the only way to satisfy it was to invent six field names
        // for one answer.
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            mappings: [
                { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
                { kind: 'acroform', ourField: 'client.name', pdfField: 'Text1' },
            ],
        }, VERSION(fielded.hash))).not.toThrow();
    });

    it('ALLOWS several checkbox mappings for one field — that is what a rating is', () => {
        // A four-way rating is four independent boxes with nothing in the file
        // grouping them; the grouping is ours. Rejecting the repeated `ourField`
        // here would make every rating unmappable.
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'IN', page: 0, x: 10, y: 20 },
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'NI', page: 0, x: 30, y: 20 },
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'NP', page: 0, x: 50, y: 20 },
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'D', page: 0, x: 70, y: 20 },
            ],
        }, VERSION(fielded.hash))).not.toThrow();
    });

    it('refuses two checkbox mappings for the same field AND the same value', () => {
        // Same value twice is two marks for one answer, i.e. a coordinate that
        // was pasted and not re-measured.
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'IN', page: 0, x: 10, y: 20 },
                { kind: 'checkbox', ourField: 'item.rating', whenValue: 'IN', page: 0, x: 30, y: 20 },
            ],
        }, VERSION(fielded.hash))).toThrow(/IN/);
    });

    it('refuses an overlay with a size of zero', () => {
        // Drawn at size 0 the value is absent from the rendered form while every
        // count of "values written" still includes it.
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [{ kind: 'overlay', ourField: 'client.name', page: 0, x: 10, y: 20, size: 0 }],
        }, VERSION(fielded.hash))).toThrow(/size/);
    });

    it('refuses a negative page index', () => {
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [{ kind: 'overlay', ourField: 'client.name', page: -1, x: 10, y: 20, size: 9 }],
        }, VERSION(fielded.hash))).toThrow(/page/);
    });
});

describe('signature mapping', () => {
    it('carries the section it signs for', () => {
        // Measured on the Citizens four-point form, page 4: a trade-specific
        // licensee signs only their own section, so one form can carry several
        // signatures that each answer for a different part of it. A single
        // form-wide signer role cannot say that.
        const mapping: FieldMapping = {
            kind: 'signature', ourField: 'inspector_signature', scope: 'electrical',
            page: 3, x: 72, y: 120, width: 160, height: 40,
        };
        expect(mapping.scope).toBe('electrical');
    });

    it('refuses a signature box with no area', () => {
        // A box with no area draws nothing while every count of "mappings
        // applied" still includes it — the signature is absent from the form and
        // present in the arithmetic.
        expect(() => validateFieldMapShape({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [{
                kind: 'signature', ourField: 'sig', scope: 'whole_form',
                page: 1, x: 10, y: 10, width: 0, height: 40,
            }],
        })).toThrow(/signature/i);
    });

    it('refuses a signature with no scope', () => {
        expect(() => validateFieldMapShape({
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [{
                kind: 'signature', ourField: 'sig', scope: '',
                page: 1, x: 10, y: 10, width: 160, height: 40,
            }],
        })).toThrow(/scope/i);
    });
});

describe('overlay fit declarations', () => {
    /** A map carrying exactly one overlay, so a test states only what it measures. */
    const withOverlay = (mapping: FieldMapping): FieldMap => ({
        ...MAP(fielded.hash), requiredFields: [], mappings: [mapping],
    });

    it('refuses a maxHeight with no height in it', () => {
        // Zero here does not mean "unbounded" — it would refuse every value.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200, maxHeight: 0,
        }))).toThrow(/maxHeight/);
    });

    it('refuses a minSize larger than the size it shrinks from', () => {
        // The floor is where shrinking stops, so it is never above the start.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200, maxHeight: 24, minSize: 12,
        }))).toThrow(/minSize/);
    });

    it('refuses a minSize of zero', () => {
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200, maxHeight: 24, minSize: 0,
        }))).toThrow(/minSize/);
    });

    it('refuses a maxHeight declared without a maxWidth', () => {
        // Without a width the text never wraps, so the height bound can never be
        // reached — it would read as a guarantee it does not give.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxHeight: 24,
        }))).toThrow(/maxWidth/);
    });

    it('refuses a maxWidth declared without a maxHeight', () => {
        // The mirror, and the more common half. `fitOverlay` returns early
        // unless BOTH are present, so a lone maxWidth measures nothing at all —
        // not in fit.ts, and not anywhere else. Measured on the Citizens
        // four-point candidate: all 48 of its overlays declared a width, none
        // declared a height, and no value was ever checked against one.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200,
        }))).toThrow(/maxHeight/);
    });

    it('refuses a minSize with a maxWidth and no maxHeight', () => {
        // A floor with nothing to shrink against is the same shape of claim:
        // three numbers that read as a measurement and bound nothing.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200, minSize: 6,
        }))).toThrow(/maxHeight/);
    });

    it('POSITIVE CONTROL — a complete fit declaration validates', () => {
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
            maxWidth: 200, maxHeight: 24, minSize: 6,
        }))).not.toThrow();
    });

    it('POSITIVE CONTROL — an overlay declaring neither still validates', () => {
        // Every map authored before these two fields existed says nothing about
        // height, and none of them may start refusing because of this change.
        expect(() => validateFieldMapShape(withOverlay({
            kind: 'overlay', ourField: 'comments', page: 0, x: 10, y: 20, size: 10,
        }))).not.toThrow();
    });
});

/**
 * Three overlays share one `ourField` on purpose: the form printed three blanks
 * and its own slashes between them, so one value has to arrive as three pieces.
 * That is the ONE new way a field may legitimately repeat, and every other way
 * it can repeat still writes one value over another.
 */
describe('validateFieldMapShape — overlays that draw one part of a value', () => {
    const withMappings = (mappings: FieldMapping[]): FieldMap => ({
        ...MAP('a'.repeat(64)), requiredFields: [], mappings,
    });

    /** The real geometry of `building_code_a_permit_application_date`, measured. */
    const THREE: FieldMapping[] = [
        { kind: 'overlay', ourField: 'permit_date', part: 'date_month', page: 0,
            x: 472.20, y: 439.84, size: 9, maxWidth: 20.10, maxHeight: 11 },
        { kind: 'overlay', ourField: 'permit_date', part: 'date_day', page: 0,
            x: 495.12, y: 439.84, size: 9, maxWidth: 19.98, maxHeight: 11 },
        { kind: 'overlay', ourField: 'permit_date', part: 'date_year', page: 0,
            x: 517.80, y: 439.84, size: 9, maxWidth: 40.02, maxHeight: 11 },
    ];

    it('POSITIVE CONTROL — three different parts of one field validate', () => {
        // Without this the refusals below would all pass against a validator
        // that rejected every parted map.
        expect(() => validateFieldMapShape(withMappings([...THREE]))).not.toThrow();
    });

    it('refuses the same part drawn twice into ONE blank', () => {
        // A pasted coordinate that was never re-measured. The second one wins
        // and nothing says the first was overwritten.
        expect(() => validateFieldMapShape(withMappings([
            ...THREE, { ...THREE[0] } as FieldMapping,
        ]))).toThrow(/permit_date.*date_month/is);
    });

    it('ALLOWS the same part drawn into two DIFFERENT printed blanks', () => {
        // A form that prints the month twice prints it twice. What the old rule
        // read as a paste was the field repeating, and a field repeating is what
        // these forms do; the paste is the COORDINATE repeating, above.
        expect(() => validateFieldMapShape(withMappings([
            ...THREE, { ...THREE[0], x: 600 } as FieldMapping,
        ]))).not.toThrow();
    });

    it('refuses a whole-value overlay beside the parts of the same field', () => {
        // 45pt of `03/15/2026` drawn across three blanks that already hold the
        // parts -- the exact failure the parts exist to prevent, reintroduced.
        expect(() => validateFieldMapShape(withMappings([
            ...THREE,
            { kind: 'overlay', ourField: 'permit_date', page: 0, x: 473.7, y: 439.84,
                size: 9, maxWidth: 88, maxHeight: 11 },
        ]))).toThrow(/permit_date.*both in parts and as a whole value/is);
    });

    it('POSITIVE CONTROL — an unparted overlay on a DIFFERENT field is fine', () => {
        expect(() => validateFieldMapShape(withMappings([
            ...THREE,
            { kind: 'overlay', ourField: 'year_built', page: 0, x: 40, y: 439.84,
                size: 9, maxWidth: 60, maxHeight: 11 },
        ]))).not.toThrow();
    });

    it('refuses two unparted overlays drawn at one coordinate', () => {
        // The rule that existed before parts, re-keyed onto the target: two
        // values at one origin, the second painted over the first.
        expect(() => validateFieldMapShape(withMappings([
            { kind: 'overlay', ourField: 'year_built', page: 0, x: 40, y: 400, size: 9 },
            { kind: 'overlay', ourField: 'stories', page: 0, x: 40, y: 400, size: 9 },
        ]))).toThrow(/40, 400/is);
    });

    it('ALLOWS one unparted value drawn at two coordinates', () => {
        expect(() => validateFieldMapShape(withMappings([
            { kind: 'overlay', ourField: 'year_built', page: 0, x: 40, y: 400, size: 9 },
            { kind: 'overlay', ourField: 'year_built', page: 0, x: 90, y: 400, size: 9 },
        ]))).not.toThrow();
    });

    it('still refuses a field mapped as both a checkbox and a drawn value', () => {
        expect(() => validateFieldMapShape(withMappings([
            ...THREE,
            { kind: 'checkbox', ourField: 'permit_date', whenValue: 'x', page: 0, x: 40, y: 400 },
        ]))).toThrow(/permit_date.*checkbox/is);
    });

    it('refuses a part family with a piece missing', () => {
        // Two of three blanks filled prints `03 /  /2026` -- which reads as an
        // inspector who skipped a box, and nothing anywhere would say otherwise.
        expect(() => validateFieldMapShape(withMappings([THREE[0], THREE[2]])))
            .toThrow(/permit_date.*date_day/is);
    });

    it('POSITIVE CONTROL — the complete family validates', () => {
        expect(() => validateFieldMapShape(withMappings([...THREE]))).not.toThrow();
    });

    it('refuses a part with no maxHeight', () => {
        // `fitOverlay` measures nothing unless BOTH bounds are declared, and
        // pdf-lib's own maxWidth only breaks at spaces -- a run of digits has
        // none, so it runs off the side of the blank in silence. A part that is
        // not measured is worse than the single overlay it replaced, because it
        // looks fixed.
        expect(() => validateFieldMapShape(withMappings([
            { ...THREE[0], maxHeight: undefined } as FieldMapping, THREE[1], THREE[2],
        ]))).toThrow(/permit_date.*date_month.*maxWidth and maxHeight/is);
    });

    it('refuses a part with no maxWidth', () => {
        expect(() => validateFieldMapShape(withMappings([
            { ...THREE[0], maxWidth: undefined } as FieldMapping, THREE[1], THREE[2],
        ]))).toThrow(/permit_date.*date_month.*maxWidth and maxHeight/is);
    });

    it('POSITIVE CONTROL — an UNPARTED overlay with neither bound is still fine', () => {
        // The bounds are required of parts only. Every map authored before they
        // existed declares neither, and must not start refusing.
        expect(() => validateFieldMapShape(withMappings([
            { kind: 'overlay', ourField: 'year_built', page: 0, x: 40, y: 400, size: 9 },
        ]))).not.toThrow();
    });

    it('refuses a part that declares minSize', () => {
        // A part's width is fixed (two digits or four), so a floor can only fire
        // when maxWidth was measured too small -- and then it shrinks the year
        // while its siblings stay put, printing a date in two sizes and hiding
        // the mis-measurement that caused it.
        expect(() => validateFieldMapShape(withMappings([
            { ...THREE[2], minSize: 7 } as FieldMapping, THREE[0], THREE[1],
        ]))).toThrow(/permit_date.*date_year.*minSize/is);
    });

    it('POSITIVE CONTROL — an UNPARTED overlay may still declare minSize', () => {
        expect(() => validateFieldMapShape(withMappings([
            { kind: 'overlay', ourField: 'comments', page: 0, x: 40, y: 400,
                size: 10, maxWidth: 200, maxHeight: 24, minSize: 7 },
        ]))).not.toThrow();
    });
});

describe('validateAgainstPdf', () => {
    it('refuses an acroform mapping naming a field the PDF does not have', async () => {
        const map: FieldMap = {
            ...MAP(fielded.hash),
            requiredFields: [],
            mappings: [{ kind: 'acroform', ourField: 'client.name', pdfField: 'Tex22' }],
        };
        await expect(validateAgainstPdf(map, fielded.bytes)).rejects.toThrow(/Tex22/);
    });

    it('POSITIVE CONTROL — the correctly spelled name validates', async () => {
        // Resolves to the PARSED DOCUMENT, not to undefined: the renderer reuses it
        // rather than parsing the same bytes a second time.
        await expect(validateAgainstPdf(MAP(fielded.hash), fielded.bytes))
            .resolves.toHaveProperty('getPageCount');
    });

    it('accepts an overlay-only map for a PDF with no fields at all', async () => {
        // A validator that required AcroForm fields would reject the shape a
        // whole class of official forms actually ships in.
        const map: FieldMap = {
            ...MAP(flat.hash),
            requiredFields: [],
            mappings: [
                { kind: 'overlay', ourField: 'owner.name', page: 0, x: 100, y: 500, size: 10 },
                { kind: 'checkbox', ourField: 'roof.covering', whenValue: 'shingle', page: 1, x: 80, y: 400 },
            ],
        };
        await expect(validateAgainstPdf(map, flat.bytes)).resolves.toHaveProperty('getPageCount');
    });

    it('refuses a map pointing at a page the PDF does not have', async () => {
        const map: FieldMap = {
            ...MAP(flat.hash),
            requiredFields: [],
            mappings: [{ kind: 'overlay', ourField: 'owner.name', page: 5, x: 10, y: 20, size: 9 }],
        };
        await expect(validateAgainstPdf(map, flat.bytes)).rejects.toThrow(/page 5/);
    });

    it('refuses bytes whose hash is not the one the map was authored against', async () => {
        // The same map against the OTHER fixture. This is the check that stops a
        // map surviving a revision: the file still parses, the field names may
        // still resolve, and the layout underneath has moved.
        await expect(validateAgainstPdf(MAP(fielded.hash), flat.bytes)).rejects.toThrow(/sourceHash/);
    });

    it('refuses bytes that are not a PDF at all', async () => {
        const notAPdf = new TextEncoder().encode('%PDF- nope');
        const map = { ...MAP(await sha256Hex(notAPdf)), requiredFields: [] };
        await expect(validateAgainstPdf(map, notAPdf)).rejects.toThrow();
    });
});

/**
 * A part's drawn width is knowable from the map alone: it is always two digits
 * or four, and every Helvetica digit advances 556/1000 of the em. So a blank too
 * small for its own part can be refused before any inspection exists -- which is
 * a different failure from "I measured the blank next door", and only this one
 * is arithmetic.
 */
describe('validateAgainstPdf — a part that cannot fit its own digits', () => {
    /** The real Q4.1 roof row on FL OIR-B1-1802: three 18.07pt blanks. */
    const roofRow = (size: number): FieldMap => ({
        ...MAP(flat.hash), requiredFields: [],
        mappings: [
            { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_month', page: 0,
                x: 166.92, y: 591.0, size, maxWidth: 18.07, maxHeight: 10.3 },
            { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_day', page: 0,
                x: 187.45, y: 591.0, size, maxWidth: 18.07, maxHeight: 10.3 },
            { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_year', page: 0,
                x: 207.98, y: 591.0, size, maxWidth: 18.07, maxHeight: 10.3 },
        ],
    });

    it('refuses a four-digit year at 9pt in an 18.07pt blank', async () => {
        // `2026` is 20.016pt at 9pt Helvetica. The blank is 18.07 -- it was cut
        // for four 9pt Times underscores, which are 18.000. Drawn at 9 it
        // overruns by 1.95pt and nothing raises today.
        await expect(validateAgainstPdf(roofRow(9), flat.bytes))
            .rejects.toThrow(/roof_permit_date.*date_year.*20\.0.*18\.07/is);
    });

    it('POSITIVE CONTROL — the same blank at 8pt is accepted', async () => {
        // 17.792 <= 18.07, by 0.274pt. Without this the check above would also
        // pass against a validator that refused every part.
        await expect(validateAgainstPdf(roofRow(8), flat.bytes)).resolves.toHaveProperty('getPageCount');
    });

    it('POSITIVE CONTROL — an unparted overlay is not measured this way', async () => {
        // The check is about a fixed-width part. A free-text overlay's width is
        // not knowable from the map, and `fit.ts` owns it at render time.
        await expect(validateAgainstPdf({
            ...MAP(flat.hash), requiredFields: [],
            mappings: [{ kind: 'overlay', ourField: 'comments', page: 0,
                x: 40, y: 400, size: 10, maxWidth: 4 }],
        }, flat.bytes)).resolves.toHaveProperty('getPageCount');
    });
});

describe('sha256Hex', () => {
    it('is the hash the rest of the subsystem compares against', async () => {
        // Pinned to a known vector so a change of algorithm or encoding cannot
        // pass by agreeing with itself.
        expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});
