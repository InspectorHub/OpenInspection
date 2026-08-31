/**
 * A choice's LABEL is what the inspector reads; its VALUE is what the form gets.
 *
 * -- The failure this exists to stop -----------------------------------------
 * `render.ts` decides whether to tick a box with `value === whenValue`, byte for
 * byte, and nothing normalises. So the moment a label reaches the results, every
 * box on the question stays empty and the authority's document prints with that
 * question unanswered. It has happened once on this branch already (`c6569cae`),
 * and it did not throw: a form that answers nothing looks exactly like a form
 * nobody filled in.
 *
 * That is why `ItemChoice` pairs the two instead of putting the labels in a
 * second map beside the values. Two lists that must agree, with nothing making
 * them agree, is the shape this project keeps being bitten by.
 *
 * -- What is asserted here ---------------------------------------------------
 * The whole chain, on a real PDF: a template attribute declaring
 * `{ value, label }` -> `collectStatutoryValues` -> `renderStatutoryForm` ->
 * the document's own field data. Plus the control, which is the half that
 * matters: storing the LABEL is REFUSED by name rather than printing blank.
 *
 * The screen half of the same chain is
 * `app/components/editor/item-attributes-choice-labels.test.tsx` — the label is
 * shown, the token is not, and clicking sends the token.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import { choiceLabel, choiceValue } from '../../../server/lib/template-choices';
import type { FieldMap } from '../../../server/lib/statutory/field-map';
import type {
    ItemChoice, StatutoryFormDeclaration, TemplateSchemaV2,
} from '../../../server/types/template-schema';
import {
    buildCheckboxPdf, readCheckBox, type PdfFixture,
} from '../helpers/statutory-pdf-fixtures';

let boxed: PdfFixture;
beforeAll(async () => { boxed = await buildCheckboxPdf(); });

/** The three boxes `buildCheckboxPdf` puts on the page, worded as a form would. */
const WIRING: ItemChoice[] = [
    { value: 'copper', label: 'Copper' },
    { value: 'aluminum', label: 'Single Strand AL' },
    { value: 'knob_and_tube', label: 'Cloth (Knob & Tube)' },
];

const map = (): FieldMap => ({
    formId: 'zz_boxed_form',
    version: '1-0',
    sourceHash: boxed.hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-31T00:00:00.000Z'),
    requiredFields: [],
    mappings: [
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'copper', pdfField: 'Box.Copper' },
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'aluminum', pdfField: 'Box.Aluminum' },
        { kind: 'acroform_checkbox', ourField: 'wiring_types', whenValue: 'knob_and_tube', pdfField: 'Box.KnobAndTube' },
    ],
});

const schema = (): TemplateSchemaV2 => ({
    schemaVersion: 2,
    sections: [{
        id: 'electrical',
        title: 'Electrical',
        items: [{
            id: 'electrical_wiring_types',
            label: 'Wiring Type(s)',
            type: 'photo_only',
            attributes: [{
                id: 'wiring_types',
                name: 'Wiring Type(s)',
                type: 'multi_select',
                choices: WIRING,
            }],
        }],
    }],
} as unknown as TemplateSchemaV2);

const declaration = (): StatutoryFormDeclaration => ({
    formId: 'zz_boxed_form',
    bindings: {
        wiring_types: { from: 'item_attribute', itemId: 'electrical_wiring_types', attribute: 'wiring_types' },
    },
} as unknown as StatutoryFormDeclaration);

const FACTS = {} as never;

function valuesFor(answer: unknown) {
    return collectStatutoryValues(
        declaration(),
        schema(),
        { electrical_wiring_types: { attributes: { wiring_types: answer } } },
        FACTS,
        {},
    );
}

describe('choice labels never reach the authority\'s form', () => {
    it('reads apart: the value is the token, the label is the wording', () => {
        expect(WIRING.map(choiceValue)).toEqual(['copper', 'aluminum', 'knob_and_tube']);
        expect(WIRING.map(choiceLabel)).toEqual(['Copper', 'Single Strand AL', 'Cloth (Knob & Tube)']);
        // A bare string still means "the value and the label are the same word",
        // which is what every template written before the pair existed says.
        expect(choiceValue('copper')).toBe('copper');
        expect(choiceLabel('copper')).toBe('copper');
    });

    it('ticks the boxes the STORED VALUES name, on the real document', async () => {
        const values = valuesFor(['copper', 'knob_and_tube']);
        expect(values.wiring_types).toEqual(['copper', 'knob_and_tube']);
        const filled = await renderStatutoryForm(boxed.bytes, map(), values);
        // Both directions. A test that only checked the two ticked boxes would
        // pass just as well against a renderer that ticks everything.
        expect(await readCheckBox(filled, 'Box.Copper')).toBe(true);
        expect(await readCheckBox(filled, 'Box.KnobAndTube')).toBe(true);
        expect(await readCheckBox(filled, 'Box.Aluminum')).toBe(false);
    });

    it('REFUSES a label stored as an answer, and names it', async () => {
        // The control, and the reason this is worth a file. Before the pair
        // existed there was nothing to store but the token; now there are two
        // strings within reach of the same click, so the wrong one has to be
        // loud.
        //
        // ⚠️ The refusal is in the RENDERER, not in the collector: measured
        // while writing this, `collectStatutoryValues` accepts the label
        // happily — it has no field map and so no idea what boxes exist. The
        // check that knows is `checkValuesAgainstMap`, which `render.ts` runs
        // against the map, and it names the field, the answer given, and the
        // boxes the form does have. Asserting it against the collector would
        // have been a green test proving nothing.
        const values = valuesFor(['Single Strand AL']);
        expect(values.wiring_types).toEqual(['Single Strand AL']);
        await expect(renderStatutoryForm(boxed.bytes, map(), values))
            .rejects.toThrow(/wiring_types.*Single Strand AL.*no box/s);
    });

    it('still prints nothing for a question nobody answered, which is not the same thing', async () => {
        // The distinction the refusal above protects: an unanswered question
        // and a question answered with a label both leave three empty boxes on
        // paper, and only one of them is legitimate.
        const filled = await renderStatutoryForm(boxed.bytes, map(), valuesFor(''));
        expect(await readCheckBox(filled, 'Box.Copper')).toBe(false);
        expect(await readCheckBox(filled, 'Box.Aluminum')).toBe(false);
        expect(await readCheckBox(filled, 'Box.KnobAndTube')).toBe(false);
    });
});
