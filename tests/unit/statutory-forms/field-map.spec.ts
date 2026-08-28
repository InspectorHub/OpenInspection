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
    sha256Hex,
    type FieldMap,
    type FieldMapping,
} from '../../../server/lib/statutory/field-map';
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
    version: '1-0',
    effectiveFrom: Date.parse('2026-01-01T00:00:00.000Z'),
    mandatoryFrom: Date.parse('2026-01-01T00:00:00.000Z'),
    effectiveUntil: null,
    sourceUrl: 'https://example.gov/forms/example.pdf',
    sourceHash: hash,
    publishedBy: 'u1',
    publishedAt: Date.parse('2026-08-21T00:00:00.000Z'),
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

    it('refuses two mappings writing the same value twice', () => {
        expect(() => validateFieldMap({
            ...MAP(fielded.hash),
            mappings: [
                { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
                { kind: 'acroform', ourField: 'client.name', pdfField: 'Text1' },
            ],
        }, VERSION(fielded.hash))).toThrow(/client\.name/);
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
        await expect(validateAgainstPdf(MAP(fielded.hash), fielded.bytes)).resolves.toBeUndefined();
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
        await expect(validateAgainstPdf(map, flat.bytes)).resolves.toBeUndefined();
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

describe('sha256Hex', () => {
    it('is the hash the rest of the subsystem compares against', async () => {
        // Pinned to a known vector so a change of algorithm or encoding cannot
        // pass by agreeing with itself.
        expect(await sha256Hex(new TextEncoder().encode('abc'))).toBe(
            'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
        );
    });
});
