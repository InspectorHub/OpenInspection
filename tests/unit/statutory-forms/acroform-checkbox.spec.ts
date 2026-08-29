/**
 * A real checkbox widget is SET, not drawn over.
 *
 * -- The failure this exists to stop ------------------------------------------
 * Measured on the Texas TREC REI 7-6, rendered onto the authority's own PDF:
 * that form has 245 form fields, 81 of them text and 164 of them genuine
 * `/Btn` checkbox widgets, and the map drew an `X` at a coordinate inside every
 * one of the 164. A 300 dpi raster confirms the mark is visible, so the PRINTED
 * document is right -- and the document's field data still says every box is
 * unticked. Anything that opens the file rather than looking at it reads an
 * unanswered form, and nothing raises.
 *
 * There is a second half to it that no assertion here can settle: annotations
 * are painted after page content, so a widget's own off-state appearance may
 * cover the mark outright. Setting the field removes the question.
 *
 * -- What this does NOT do ---------------------------------------------------
 * It does not change what an existing `checkbox` mapping means. A form with no
 * fillable anything -- both Florida forms -- has no widget to set, and drawing
 * the mark is the only route it has. The two kinds are two routes for two
 * shapes of form, exactly as `acroform` and `overlay` already are.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import {
    validateAgainstPdf, validateFieldMapShape, type FieldMap,
} from '../../../server/lib/statutory/field-map';
import {
    buildCheckboxPdf, pageContentDigests, readCheckBox, readFieldValue, type PdfFixture,
} from '../helpers/statutory-pdf-fixtures';
import { drawnRuns } from '../helpers/pdf-drawn-runs';

let boxed: PdfFixture;

beforeAll(async () => {
    boxed = await buildCheckboxPdf();
});

const boxedMap = (): FieldMap => ({
    formId: 'zz_boxed_form',
    version: '1-0',
    sourceHash: boxed.hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-29T00:00:00.000Z'),
    requiredFields: [],
    mappings: [
        { kind: 'acroform', ourField: 'client.name', pdfField: 'Name of Client' },
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'copper', pdfField: 'Box.Copper' },
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'aluminum', pdfField: 'Box.Aluminum' },
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'knob_and_tube', pdfField: 'Box.KnobAndTube' },
    ],
});

describe('setting a real checkbox widget', () => {
    it('leaves the document DATA saying the box is ticked', async () => {
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), {
            wiring_types: 'aluminum',
        });
        expect(await readCheckBox(filled, 'Box.Aluminum')).toBe(true);
    });

    it('leaves every box the answer did not choose unticked', async () => {
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), {
            wiring_types: 'aluminum',
        });
        expect(await readCheckBox(filled, 'Box.Copper')).toBe(false);
        expect(await readCheckBox(filled, 'Box.KnobAndTube')).toBe(false);
    });

    it('ticks every box a multi-select answer names', async () => {
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), {
            wiring_types: ['copper', 'knob_and_tube'],
        });
        expect([
            await readCheckBox(filled, 'Box.Copper'),
            await readCheckBox(filled, 'Box.Aluminum'),
            await readCheckBox(filled, 'Box.KnobAndTube'),
        ]).toEqual([true, false, true]);
    });

    it('draws NOTHING on the page — the page stream stays byte-identical', async () => {
        // This is what separates setting the widget from drawing over it. A
        // mark drawn at a coordinate changes the page's content stream; setting
        // a field does not touch the page at all.
        const before = await pageContentDigests(boxed.bytes);
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), {
            wiring_types: 'aluminum',
        });
        expect(await pageContentDigests(filled)).toEqual(before);
        expect((await drawnRuns(filled, 0)).filter((r) => r.text === 'X')).toHaveLength(0);
    });

    it('still fills the text fields beside them', async () => {
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), {
            'client.name': 'Zoe Ng', wiring_types: 'copper',
        });
        expect(await readFieldValue(filled, 'Name of Client')).toBe('Zoe Ng');
        expect(await readCheckBox(filled, 'Box.Copper')).toBe(true);
    });

    it('refuses an answer no box on this form carries', async () => {
        await expect(renderStatutoryForm(boxed.bytes, boxedMap(), {
            wiring_types: ['copper', 'greenfield'],
        })).rejects.toThrow(/greenfield/);
    });

    it('POSITIVE CONTROL — an empty answer ticks nothing and still renders', async () => {
        const filled = await renderStatutoryForm(boxed.bytes, boxedMap(), { wiring_types: '' });
        expect(await readCheckBox(filled, 'Box.Copper')).toBe(false);
    });
});

describe('the widget has to be the kind the mapping says it is', () => {
    it('refuses a mapping that names a TEXT field', async () => {
        // The mirror of the limit `acroform` already carries. Guessing would
        // set nothing and raise nothing, which is the state this replaces.
        const map: FieldMap = {
            ...boxedMap(),
            mappings: [{
                kind: 'acroform_checkbox', ourField: 'wiring_types',
                whenValue: 'copper', pdfField: 'Name of Client',
            }],
        };
        await expect(renderStatutoryForm(boxed.bytes, map, { wiring_types: 'copper' }))
            .rejects.toThrow(/Name of Client/);
    });

    it('refuses a name this PDF does not have at all', async () => {
        const map: FieldMap = {
            ...boxedMap(),
            mappings: [{
                kind: 'acroform_checkbox', ourField: 'wiring_types',
                whenValue: 'copper', pdfField: 'Box.Nonexistent',
            }],
        };
        await expect(validateAgainstPdf(map, boxed.bytes)).rejects.toThrow(/Box\.Nonexistent/);
    });
});

describe('the shape rules reach the new kind', () => {
    it('refuses an empty pdfField', () => {
        expect(() => validateFieldMapShape({
            ...boxedMap(),
            mappings: [{
                kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'copper', pdfField: '  ',
            }],
        })).toThrow(/pdfField/);
    });

    it('refuses an empty whenValue — a box with no trigger marks itself always', () => {
        expect(() => validateFieldMapShape({
            ...boxedMap(),
            mappings: [{
                kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: '', pdfField: 'Box.Copper',
            }],
        })).toThrow(/whenValue/);
    });

    it('refuses two mappings setting one widget', () => {
        expect(() => validateFieldMapShape({
            ...boxedMap(),
            mappings: [
                { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'copper', pdfField: 'Box.Copper' },
                { kind: 'acroform_checkbox', ourField: 'pipe_types', whenValue: 'pex', pdfField: 'Box.Copper' },
            ],
        })).toThrow(/Box\.Copper/);
    });

    it('refuses a field that both sets a widget and writes text', () => {
        expect(() => validateFieldMapShape({
            ...boxedMap(),
            mappings: [
                { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'copper', pdfField: 'Box.Copper' },
                { kind: 'acroform', ourField: 'wiring_types', pdfField: 'Name of Client' },
            ],
        })).toThrow(/wiring_types/);
    });

    it('POSITIVE CONTROL — the map as published validates', () => {
        expect(() => validateFieldMapShape(boxedMap())).not.toThrow();
    });
});
