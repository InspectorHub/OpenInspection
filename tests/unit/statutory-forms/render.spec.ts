/**
 * What we output IS the authority's document, with our values written onto it.
 *
 * The page-digest assertions below are the only thing that can prove we did not
 * rebuild the form. Rebuilding is the failure mode of the approach this one
 * replaced — laying the form out again in HTML or in drawing calls — and it is
 * invisible from the inside: a close-enough rebuild passes every assertion about
 * its own values, prints, and looks right until somebody measures it against the
 * original. So each test that writes something also states what stayed
 * identical.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import type { FieldMap, FieldMapping } from '../../../server/lib/statutory/field-map';
import { extractPdfText } from '../../../server/lib/migration-intake/pdf-text';
import {
    buildFieldedPdf,
    buildFlatPdf,
    pageContentDigests,
    readFieldValue,
    type PdfFixture,
} from '../helpers/statutory-pdf-fixtures';
import { drawnRuns } from '../helpers/pdf-drawn-runs';

let fielded: PdfFixture;
let flat: PdfFixture;

beforeAll(async () => {
    fielded = await buildFieldedPdf();
    flat = await buildFlatPdf();
});

const CHECKED = { checkedBy: 'a.operator', checkedAt: Date.parse('2026-08-21T00:00:00.000Z') };

/** An AcroForm map: values go into named fields, nothing is drawn. */
const fieldedMap = (): FieldMap => ({
    formId: 'xx_example_form', version: '1-0', sourceHash: fielded.hash, ...CHECKED,
    requiredFields: ['client.name'],
    mappings: [
        { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
        { kind: 'acroform', ourField: 'property.address', pdfField: 'Text1' },
    ],
});

/** A flat map: everything is drawn at a measured coordinate, page 1 only. */
const flatMap = (): FieldMap => ({
    formId: 'yy_flat_form', version: 'Rev. 04/26', sourceHash: flat.hash, ...CHECKED,
    requiredFields: ['owner.name'],
    mappings: [
        { kind: 'overlay', ourField: 'owner.name', page: 1, x: 100, y: 500, size: 10 },
        { kind: 'checkbox', ourField: 'roof.covering', whenValue: 'shingle', page: 1, x: 80, y: 400 },
        { kind: 'checkbox', ourField: 'roof.covering', whenValue: 'tile', page: 1, x: 120, y: 400 },
    ],
});

describe('renderStatutoryForm — the page underneath', () => {
    it('leaves every page we drew nothing on byte-identical', async () => {
        const filled = await renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'tile',
        });
        const before = await pageContentDigests(flat.bytes);
        const after = await pageContentDigests(filled);
        expect(after).toHaveLength(before.length);
        // Page 0 carries no mapping in `flatMap`, so it must be the agency's
        // page, byte for byte.
        expect(after[0]).toBe(before[0]);
    });

    it('POSITIVE CONTROL — the page we DID draw on differs', async () => {
        // Without this, the assertion above passes for a renderer that writes
        // nothing at all.
        const filled = await renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'tile',
        });
        const before = await pageContentDigests(flat.bytes);
        const after = await pageContentDigests(filled);
        expect(after[1]).not.toBe(before[1]);
    });

    it('keeps the agency\'s own text on the page it drew onto', async () => {
        // "Untouched pages are identical" would also hold for a renderer that
        // replaced page 1 entirely. The original text has to survive on the page
        // we wrote on, not merely on the pages we did not.
        const filled = await renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'tile',
        });
        const text = await extractPdfText(filled);
        expect(text?.[1]).toContain('OFFICIAL FORM — page two');
        expect(text?.[0]).toBe('OFFICIAL FORM — page one');
    });

    it('an AcroForm fill changes NO page content stream', async () => {
        // Stated because it is surprising and load-bearing: a form field's value
        // lives in the widget, not in the page. On a fillable form every page
        // digest is unchanged and the document is still filled in — which is why
        // the digest check alone is not evidence that values arrived, and every
        // test here pairs it with a readback.
        const filled = await renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'client.name': 'Zoe Ng', 'property.address': '12 Example St',
        });
        expect(await pageContentDigests(filled)).toEqual(await pageContentDigests(fielded.bytes));
        expect(await readFieldValue(filled, 'Name of Client')).toBe('Zoe Ng');
    });
});

describe('renderStatutoryForm — values', () => {
    it('fills an AcroForm field by name', async () => {
        const filled = await renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'client.name': 'Zoe Ng', 'property.address': '12 Example St',
        });
        expect(await readFieldValue(filled, 'Name of Client')).toBe('Zoe Ng');
        expect(await readFieldValue(filled, 'Text1')).toBe('12 Example St');
    });

    it('draws at coordinates when the PDF has no fields', async () => {
        const filled = await renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'tile',
        });
        expect((await extractPdfText(filled))?.[1]).toContain('Zoe Ng');
    });

    it('marks the checkbox whose value matches, and only that one', async () => {
        const filled = await renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'tile',
        });
        // One mark, not two: an answer that ticked every box would still satisfy
        // "the right box is ticked".
        const marks = ((await extractPdfText(filled))?.[1] ?? '').match(/X/g) ?? [];
        expect(marks).toHaveLength(1);
    });

    it('refuses a value with no mapping rather than dropping it', async () => {
        // A dropped value is a blank on a statutory form: the inspector's
        // problem and our fault.
        await expect(renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'client.name': 'Zoe Ng', 'unmapped.field': 'x',
        })).rejects.toThrow(/unmapped\.field/);
    });

    it('refuses a checkbox value matching none of its boxes', async () => {
        // Same failure wearing a different hat: `metal` has a mapping for the
        // FIELD and no box for the ANSWER, so the answer would vanish while
        // every count of mapped fields still looked complete.
        await expect(renderStatutoryForm(flat.bytes, flatMap(), {
            'owner.name': 'Zoe Ng', 'roof.covering': 'metal',
        })).rejects.toThrow(/metal/);
    });

    it('refuses to render a required field that was never supplied', async () => {
        // The distinction this whole subsystem turns on: a form nobody filled
        // must not be producible at all.
        await expect(renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'property.address': '12 Example St',
        })).rejects.toThrow(/client\.name/);
    });

    it('POSITIVE CONTROL — an explicit empty answer IS accepted and renders', async () => {
        // ...and this is the other half: an inspector who answered "nothing" has
        // answered, and their form must be producible.
        //
        // ⚠️ MEASURED, and it decides where the distinction can live: the two
        // cases are indistinguishable IN THE PDF. A text field set to an empty
        // string reads back exactly like one that was never set — `undefined`
        // either way — because an empty value is stored by storing nothing. So
        // "never filled" cannot be told from "filled and left empty" downstream
        // by any reader, and the only place the difference survives is the
        // refusal above, at the input boundary, before a document exists.
        const filled = await renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'client.name': '', 'property.address': '12 Example St',
        });
        expect(await readFieldValue(filled, 'Name of Client') ?? '').toBe('');
        expect(await readFieldValue(filled, 'Text1')).toBe('12 Example St');
    });

    it('refuses bytes that are not the revision the map was authored against', async () => {
        // The map is valid, the PDF parses, the coordinates are all in range —
        // and the layout underneath is a different document.
        await expect(renderStatutoryForm(fielded.bytes, flatMap(), { 'owner.name': 'Zoe Ng' }))
            .rejects.toThrow(/sourceHash/);
    });

    it('renders nothing at all when the map itself is invalid', async () => {
        const broken: FieldMap = { ...flatMap(), checkedBy: '' };
        await expect(renderStatutoryForm(flat.bytes, broken, { 'owner.name': 'Zoe Ng' }))
            .rejects.toThrow(/checkedBy/);
    });

    it('refuses to render a signature mapping until signature support lands', async () => {
        // A mapping kind the renderer does not recognise would fall through and
        // be skipped, producing a form with an EMPTY signature box — which
        // prints, looks complete, and passes every assertion in this file about
        // its own values. Until the image is actually drawn it has to be an
        // error, not a gap.
        const map: FieldMap = {
            ...flatMap(),
            requiredFields: [],
            mappings: [{
                kind: 'signature', ourField: 'sig', scope: 'whole_form',
                page: 1, x: 10, y: 10, width: 160, height: 40,
            }],
        };
        await expect(renderStatutoryForm(flat.bytes, map, {}))
            .rejects.toThrow(/signature rendering is not implemented/i);
    });
});

/**
 * A value that does not fit its row is the ordinary case on these forms, not the
 * edge one: 47 of the 72 overlay rows on one measured form and 47 of 48 on the
 * other have room for a single line.
 *
 * Both ways of getting it wrong end in the same place — a form that LOOKS
 * filled. Drawn text wraps downward with no bound and writes over the row
 * beneath; a form field clips whatever the widget cannot show. Neither raises
 * anything, and neither is visible to the person who files the document.
 */
describe('renderStatutoryForm — text that has to fit the room measured for it', () => {
    /** A flat map carrying exactly one mapping, so a test states only what it measures. */
    const mapWith = (mapping: FieldMapping): FieldMap => ({
        ...flatMap(), requiredFields: [], mappings: [mapping],
    });

    const LONG = 'a fairly long comment that will not fit on one line at ten point';

    it('shrinks an overlay value to fit its stated height before giving up', async () => {
        const bytes = await renderStatutoryForm(flat.bytes, mapWith({
            kind: 'overlay', ourField: 'comments', page: 0,
            x: 40, y: 700, size: 10, maxWidth: 200, maxHeight: 12, minSize: 6,
        }), { comments: LONG });
        // It fits at a smaller size, so it renders rather than throwing — and it
        // is ON the page: "did not throw" would also hold for a renderer that
        // quietly wrote nothing.
        const before = await pageContentDigests(flat.bytes);
        const after = await pageContentDigests(bytes);
        expect(after[0]).not.toBe(before[0]);
    });

    it('CONTROL — the same value in the same row is refused when it may not shrink', async () => {
        // This is what makes the test above evidence of shrinking rather than of
        // a value that happened to fit at its declared size all along. Identical
        // geometry, identical text; the only difference is that the floor is the
        // starting size, so there is nowhere to go.
        await expect(renderStatutoryForm(flat.bytes, mapWith({
            kind: 'overlay', ourField: 'comments', page: 0,
            x: 40, y: 700, size: 10, maxWidth: 200, maxHeight: 12, minSize: 10,
        }), { comments: LONG })).rejects.toThrow(/comments.*fits about \d+/is);
    });

    it('refuses when the value cannot fit even at minSize, naming both numbers', async () => {
        // Never truncate: a clipped statutory form looks like a filled one. And
        // never shrink past the declared floor either — that produces an answer
        // nobody can read, which is the same failure in smaller type.
        await expect(renderStatutoryForm(flat.bytes, mapWith({
            kind: 'overlay', ourField: 'comments', page: 0,
            x: 40, y: 700, size: 10, maxWidth: 200, maxHeight: 12, minSize: 9,
        }), { comments: 'x'.repeat(4000) }))
            .rejects.toThrow(/comments.*fits about \d+.*received 4000.*additional page/is);
    });

    it('leaves an overlay that declares NEITHER bound exactly as it renders today', async () => {
        // An overlay with neither bound is the ordinary case on a map authored
        // before these fields existed. It must not start refusing.
        //
        // ⚠️ A width WITHOUT a height is a different case and is refused at load
        // now — see `field-map.spec.ts`. `fitOverlay` measures nothing unless
        // both are present, so declaring one was a bound that bound nothing.
        const bytes = await renderStatutoryForm(flat.bytes, mapWith({
            kind: 'overlay', ourField: 'comments', page: 0, x: 40, y: 700, size: 10,
        }), { comments: 'short' });
        expect(bytes.byteLength).toBeGreaterThan(0);

        // Stated with the value that WOULD be refused under a height bound, so
        // this test cannot pass merely because the string was small.
        const unbounded = await renderStatutoryForm(flat.bytes, mapWith({
            kind: 'overlay', ourField: 'comments', page: 0, x: 40, y: 700, size: 10,
        }), { comments: 'x'.repeat(4000) });
        expect(unbounded.byteLength).toBeGreaterThan(0);
    });

    it('refuses an acroform value the widget would clip', async () => {
        // The mirror failure. `setTextField` hands the value to the widget, which
        // shows what it can and drops the rest — same outcome as an overflow, and
        // the only difference is which end of the answer goes missing.
        await expect(renderStatutoryForm(fielded.bytes, {
            ...fieldedMap(), requiredFields: [],
            mappings: [{ kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' }],
        }, { 'client.name': 'x'.repeat(200) }))
            .rejects.toThrow(/client\.name.*fits about \d+.*received 200.*additional page/is);
    });

    it('POSITIVE CONTROL — a value the widget can hold is still written', async () => {
        // Without this, a check that refused every acroform value would pass the
        // test above and prove nothing.
        const filled = await renderStatutoryForm(fielded.bytes, fieldedMap(), {
            'client.name': 'Zoe Ng', 'property.address': '12 Example St',
        });
        expect(await readFieldValue(filled, 'Name of Client')).toBe('Zoe Ng');
    });
});

describe('renderStatutoryForm — a value drawn in parts', () => {
    /** The measured geometry of `building_code_a_permit_application_date`. */
    const partedMap = (): FieldMap => ({
        ...flatMap(), requiredFields: [],
        mappings: [
            { kind: 'overlay', ourField: 'permit_date', part: 'date_month', page: 0,
                x: 472.20, y: 439.84, size: 9, maxWidth: 20.10, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit_date', part: 'date_day', page: 0,
                x: 495.12, y: 439.84, size: 9, maxWidth: 19.98, maxHeight: 11 },
            { kind: 'overlay', ourField: 'permit_date', part: 'date_year', page: 0,
                x: 517.80, y: 439.84, size: 9, maxWidth: 40.02, maxHeight: 11 },
        ],
    });

    it('refuses a value that is not a calendar day, before any document exists', async () => {
        await expect(renderStatutoryForm(flat.bytes, partedMap(), { permit_date: 'March 2026' }))
            .rejects.toThrow(/permit_date.*not a YYYY-MM-DD.*date item/is);
    });

    it('POSITIVE CONTROL — an empty answer leaves the blanks empty and still produces', async () => {
        // This is the control that catches a parser refusing everything. An
        // empty string is an inspector answering "nothing", and a form somebody
        // filled with an empty answer must still be producible.
        const bytes = await renderStatutoryForm(flat.bytes, partedMap(), { permit_date: '' });
        expect(bytes.byteLength).toBeGreaterThan(0);
        const before = await pageContentDigests(flat.bytes);
        expect((await pageContentDigests(bytes))[0]).toBe(before[0]);
    });

    it('names every unreadable value at once, not the first one', async () => {
        const twoFields: FieldMap = {
            ...partedMap(),
            mappings: [
                ...partedMap().mappings,
                { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_month', page: 0,
                    x: 166.92, y: 591.0, size: 8, maxWidth: 18.07, maxHeight: 10.3 },
                { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_day', page: 0,
                    x: 187.45, y: 591.0, size: 8, maxWidth: 18.07, maxHeight: 10.3 },
                { kind: 'overlay', ourField: 'roof_permit_date', part: 'date_year', page: 0,
                    x: 207.98, y: 591.0, size: 8, maxWidth: 18.07, maxHeight: 10.3 },
            ],
        };
        // A person holding two broken bindings should be told about two.
        await expect(renderStatutoryForm(flat.bytes, twoFields, {
            permit_date: 'soon', roof_permit_date: '15/03/2026',
        })).rejects.toThrow(/permit_date[\s\S]*roof_permit_date/);
    });

    it('puts each part at the coordinate measured for its own blank', async () => {
        const bytes = await renderStatutoryForm(flat.bytes, partedMap(), {
            permit_date: '2026-03-15',
        });
        const runs = (await drawnRuns(bytes, 0)).filter((r) => /^\d+$/.test(r.text));
        expect(runs).toEqual([
            { text: '03',   x: 472.20, y: 439.84, size: 9 },
            { text: '15',   x: 495.12, y: 439.84, size: 9 },
            { text: '2026', x: 517.80, y: 439.84, size: 9 },
        ]);
    });

    it('CONTROL — one overlay for the whole date puts the year in the WRONG blank', async () => {
        // This is the measured bug, asserted, so the test above is evidence of
        // placement rather than of "something was drawn". The form's blanks are
        // MM 472.20–492.30, DD 495.12–515.10, YYYY 517.80–557.81, with the
        // form's own slashes printed in the two gaps.
        const bytes = await renderStatutoryForm(flat.bytes, {
            ...flatMap(), requiredFields: [],
            mappings: [{ kind: 'overlay', ourField: 'permit_date', page: 0,
                x: 473.7, y: 439.84, size: 9, maxWidth: 88, maxHeight: 11 }],
        }, { permit_date: '03/15/2026' });

        const [run] = (await drawnRuns(bytes, 0)).filter((r) => r.text.includes('/'));
        expect(run.text).toBe('03/15/2026');
        // 45.036pt from 473.7 ends at 518.736. The year blank starts at 517.80
        // and is 40.02 wide, so 0.936pt of it is covered and 39.08 stay empty —
        // while our own slashes are drawn beside the form's printed ones.
        expect(run.x).toBe(473.7);
        expect(run.x + 45.036).toBeCloseTo(518.736, 3);
    });
});
