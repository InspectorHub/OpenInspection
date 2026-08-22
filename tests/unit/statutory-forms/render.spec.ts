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
import type { FieldMap } from '../../../server/lib/statutory/field-map';
import { extractPdfText } from '../../../server/lib/migration-intake/pdf-text';
import {
    buildFieldedPdf,
    buildFlatPdf,
    pageContentDigests,
    readFieldValue,
    type PdfFixture,
} from '../helpers/statutory-pdf-fixtures';

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
});
