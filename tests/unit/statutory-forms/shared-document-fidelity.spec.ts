/**
 * Rendering must not add anything to a document it was only asked to draw on.
 *
 * `validateAgainstPdf` now hands its parsed document to `renderStatutoryForm`
 * instead of the renderer parsing the same bytes again. That saves a parse and
 * introduces one hazard worth a test of its own: pdf-lib's `getForm()` does not
 * merely READ the AcroForm, it CREATES one when the document has none. Asking
 * for the form during validation and then handing that document on would put a
 * dictionary of ours into every flat form that passed through -- a document the
 * authority published and we were supposed to leave alone apart from the marks
 * we draw.
 *
 * The renderer already states this principle where it embeds its font: "adding
 * one would put an object of ours into a document we did not otherwise touch."
 * The mitigation is that the form is read only when the map names AcroForm
 * fields, which is exactly when the renderer will read it anyway. This file is
 * what stops that quietly regressing, because nothing else would notice: every
 * value still lands in the right place, the render gate still reads all of them
 * back, and the only difference is an object nobody looks at.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import type { FieldMap } from '../../../server/lib/statutory/field-map';
import { PDFDocument, PDFName } from 'pdf-lib';
import { buildFlatPdf, buildFieldedPdf, type PdfFixture } from '../helpers/statutory-pdf-fixtures';

let flat: PdfFixture;
let fielded: PdfFixture;

beforeAll(async () => {
    flat = await buildFlatPdf();
    fielded = await buildFieldedPdf();
});

/**
 * Does this PDF carry an interactive form?
 *
 * Read off the catalog with `get`, NOT with `getForm()`: the call that would
 * most naturally answer this question is the same call that changes the answer.
 *
 * ⚠️ This started life as a substring search for "/AcroForm" in the raw bytes,
 * on the reasoning that reading the bytes could not disturb them. The control
 * below caught it immediately: pdf-lib saves with object streams, so the
 * catalog is Flate-compressed and the literal never appears. That detector
 * reported "no form" for every document ever handed to it, and the assertion
 * this file exists for would have passed without checking anything.
 */
const hasAcroForm = async (bytes: Uint8Array): Promise<boolean> => {
    const doc = await PDFDocument.load(bytes);
    return doc.catalog.get(PDFName.of('AcroForm')) !== undefined;
};

const overlayOnly = (hash: string): FieldMap => ({
    formId: 'zz_flat_form',
    version: '1-0',
    sourceHash: hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-29T00:00:00.000Z'),
    requiredFields: [],
    mappings: [
        { kind: 'overlay', ourField: 'owner.name', page: 0, x: 100, y: 500, size: 10 },
    ],
});

const throughTheForm = (hash: string): FieldMap => ({
    formId: 'zz_fielded_form',
    version: '1-0',
    sourceHash: hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-29T00:00:00.000Z'),
    requiredFields: [],
    mappings: [
        { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
    ],
});

describe('a flat form keeps its shape', () => {
    it('CONTROL — the fixture really has no form to begin with', async () => {
        // Without this the assertion below is satisfied by a detector that
        // never finds a form in anything.
        expect(await hasAcroForm(flat.bytes)).toBe(false);
    });

    it('CONTROL — and the detector really does find one when there is one', async () => {
        expect(await hasAcroForm(fielded.bytes)).toBe(true);
    });

    it('does not gain an AcroForm by being rendered', async () => {
        const out = await renderStatutoryForm(flat.bytes, overlayOnly(flat.hash), {
            'owner.name': 'A Name',
        });
        expect(await hasAcroForm(out)).toBe(false);
    });

    it('POSITIVE CONTROL — a form-bearing document still keeps its form', async () => {
        // The mitigation is "read the form only when the map needs it", not
        // "never read the form". A change that satisfied the assertion above by
        // never touching AcroForms at all would break this one.
        const out = await renderStatutoryForm(fielded.bytes, throughTheForm(fielded.hash), {
            'client.name': 'A Name',
        });
        expect(await hasAcroForm(out)).toBe(true);
    });
});
