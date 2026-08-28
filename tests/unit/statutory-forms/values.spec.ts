/**
 * A value with no answer and a value answered "nothing" are different facts,
 * and the PDF format cannot tell them apart afterwards — measured against the
 * format in `render.ts`: a field set to an empty string is stored by storing
 * nothing, so it reads back identically to one that was never set.
 *
 * So the distinction has to be made HERE, before a document exists. This
 * collector is the upstream end of the boundary `renderStatutoryForm` documents.
 */
import { describe, it, expect } from 'vitest';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type { FieldGroup, StatutoryFormDeclaration, TemplateSchemaV2 } from '../../../server/types/template-schema';

const SNAPSHOT = {
    schemaVersion: 2,
    sections: [{
        id: 'sec_roof',
        title: 'Roof',
        items: [
            { id: 'itm_roof', label: 'Covering', type: 'rich' },
            {
                id: 'itm_attic', label: 'Attic', type: 'rich',
                attributes: [{ id: 'attr_material', name: 'Material', type: 'text' }],
            },
        ],
    }],
} as unknown as TemplateSchemaV2;

const FACTS = {
    client_name: 'Zoe Ng',
    client_email: null,
    client_phone: null,
    property_address: '1 Main St',
    property_city: 'Austin',
    property_state: 'TX',
    property_zip: '78701',
    inspection_date: '2026-05-01',
    inspector_name: 'Sam Reed',
    inspector_license: 'TX-12345',
    company_name: 'Reed Home Inspections',
    company_phone: '512-555-0142',
};

/** Every inspection-level fact unanswered. Used where the assertion is about
 *  the ROUTE a binding takes rather than about any fact it reads. */
const EMPTY_FACTS = {
    client_name: null,
    client_email: null,
    client_phone: null,
    property_address: null,
    property_city: null,
    property_state: null,
    property_zip: null,
    inspection_date: null,
    inspector_name: null,
    inspector_license: null,
    company_name: null,
    company_phone: null,
};

const DECL: StatutoryFormDeclaration = {
    formId: 'tx_trec_rei',
    bindings: { 'roof.covering': { from: 'item', itemId: 'itm_roof' } },
};

const DECL_BAD_ITEM: StatutoryFormDeclaration = {
    formId: 'tx_trec_rei',
    bindings: { 'roof.covering': { from: 'item', itemId: 'itm_does_not_exist' } },
};

const DECL_BAD_KIND = {
    formId: 'tx_trec_rei',
    bindings: { 'roof.covering': { from: 'telepathy' } },
};

const DECL_WITH_UNMAPPED: StatutoryFormDeclaration = {
    formId: 'tx_trec_rei',
    bindings: { 'not.on.this.form': { from: 'literal', value: 'x' } },
};

describe('collectStatutoryValues — absent versus empty', () => {
    it('an item the inspector left blank yields an explicit empty string', () => {
        const values = collectStatutoryValues(DECL, SNAPSHOT, { itm_roof: { rating: '' } }, FACTS);
        expect(Object.prototype.hasOwnProperty.call(values, 'roof.covering')).toBe(true);
        expect(values['roof.covering']).toBe('');
    });

    it('POSITIVE CONTROL — an item with an answer yields that answer', () => {
        // Without this the assertion above passes for a collector that emits ''
        // for everything.
        const values = collectStatutoryValues(DECL, SNAPSHOT, { itm_roof: { rating: 'D' } }, FACTS);
        expect(values['roof.covering']).toBe('D');
    });

    it('an item with no result row at all still yields an explicit empty string', () => {
        // Not answering and answering nothing are the same fact from the
        // INSPECTOR's side here: the item exists on the form and nobody filled
        // it. What must never happen is the key going missing, because a
        // missing key is what `renderStatutoryForm` refuses on for a required
        // field — and that refusal is meant for a broken template, not for an
        // inspection somebody simply has not finished.
        const values = collectStatutoryValues(DECL, SNAPSHOT, {}, FACTS);
        expect(Object.prototype.hasOwnProperty.call(values, 'roof.covering')).toBe(true);
        expect(values['roof.covering']).toBe('');
    });
});

describe('collectStatutoryValues — refusals', () => {
    it('a binding pointing at an item the snapshot does not have REFUSES', () => {
        // The dangerous alternative is yielding ''. That is a blank on a
        // statutory document, and a blank looks exactly like an answer nobody
        // had.
        expect(() => collectStatutoryValues(DECL_BAD_ITEM, SNAPSHOT, {}, FACTS))
            .toThrow(/itm_does_not_exist/);
    });

    it('an attribute the item does not declare REFUSES, naming it', () => {
        const decl: StatutoryFormDeclaration = {
            formId: 'tx_trec_rei',
            bindings: { 'attic.material': { from: 'item_attribute', itemId: 'itm_attic', attribute: 'attr_nope' } },
        };
        expect(() => collectStatutoryValues(decl, SNAPSHOT, {}, FACTS)).toThrow(/attr_nope/);
    });

    it('an unrecognised source kind REFUSES rather than being skipped', () => {
        expect(() => collectStatutoryValues(DECL_BAD_KIND as never, SNAPSHOT, {}, FACTS)).toThrow();
    });
});

describe('collectStatutoryValues — the four sources', () => {
    it('reads an item attribute the item does declare', () => {
        const decl: StatutoryFormDeclaration = {
            formId: 'tx_trec_rei',
            bindings: { 'attic.material': { from: 'item_attribute', itemId: 'itm_attic', attribute: 'attr_material' } },
        };
        const values = collectStatutoryValues(
            decl, SNAPSHOT, { itm_attic: { attributes: { attr_material: 'Plywood' } } }, FACTS,
        );
        expect(values['attic.material']).toBe('Plywood');
    });

    it('reads an inspection-level fact', () => {
        const decl: StatutoryFormDeclaration = {
            formId: 'tx_trec_rei',
            bindings: { 'client.name': { from: 'inspection', field: 'client_name' } },
        };
        expect(collectStatutoryValues(decl, SNAPSHOT, {}, FACTS)['client.name']).toBe('Zoe Ng');
    });

    it('returns a literal as it stands', () => {
        expect(collectStatutoryValues(DECL_WITH_UNMAPPED, SNAPSHOT, {}, FACTS)['not.on.this.form']).toBe('x');
    });

    it('does NOT trim — a deliberate leading space survives', () => {
        const decl: StatutoryFormDeclaration = {
            formId: 'tx_trec_rei',
            bindings: { pad: { from: 'literal', value: '  A' } },
        };
        expect(collectStatutoryValues(decl, SNAPSHOT, {}, FACTS)['pad']).toBe('  A');
    });
});

describe('collectStatutoryValues — one refusal, one place', () => {
    it('does NOT pre-check that every field has a mapping on the form', () => {
        // `checkValuesAgainstMap` in render.ts owns that check. A second
        // half-check here is why the next person fixes only one of them.
        const values = collectStatutoryValues(DECL_WITH_UNMAPPED, SNAPSHOT, {}, FACTS);
        expect(values).toHaveProperty('not.on.this.form');
    });
});

describe('collectStatutoryValues — company identity', () => {
    it('resolves company identity from the workspace config', () => {
        const values = collectStatutoryValues(
            {
                formId: 'f',
                bindings: {
                    company_name: { from: 'inspection', field: 'company_name' },
                    company_phone: { from: 'inspection', field: 'company_phone' },
                },
            },
            { schemaVersion: 2, sections: [] },
            {},
            { ...EMPTY_FACTS, company_name: 'Acme Inspections', company_phone: '555-0100' },
        );
        expect(values).toEqual({ company_name: 'Acme Inspections', company_phone: '555-0100' });
    });
});

describe('collectStatutoryValues — a signature never travels through the values', () => {
    it('never puts a signature into the collected values', () => {
        const values = collectStatutoryValues(
            {
                formId: 'f',
                bindings: {
                    roof_cover: { from: 'literal', value: 'Shingle' },
                    inspector_signature: { from: 'signature', scope: 'whole_form' },
                },
            },
            { schemaVersion: 2, sections: [] },
            {},
            EMPTY_FACTS,
        );
        expect(values).toEqual({ roof_cover: 'Shingle' });
        // Assert the KEY is absent, not that it is empty: an empty string would
        // still have travelled through the values object.
        expect('inspector_signature' in values).toBe(false);
    });
});

/**
 * Repeatable blocks — the half of the group design the product could not reach.
 *
 * `groups.ts` was built, unit-tested and never called: nothing read
 * `declaration.groups`, so the over-capacity refusal — the reason groups exist
 * at all — could not happen to anybody. These tests are about the WIRING, which
 * is why they assert on values the collector produces rather than on the
 * helpers it delegates to.
 */
describe('collectStatutoryValues — repeatable groups', () => {
    const PANELS: FieldGroup = {
        id: 'electrical_panel',
        label: 'Electrical Panel',
        capacity: 2,
        slotLabels: ['Main Panel', 'Second Panel'],
        fields: ['total_amps'],
    };

    const EMPTY_SNAPSHOT = { schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2;

    it('expands one recorded instance per slot, in the order the form prints them', () => {
        // Distinguishable values on purpose. Equal ones would pass just as well
        // for a collector that wrote both slots from instance 0.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '100' }, { total_amps: '200' }] },
        );
        expect(values).toEqual({
            'electrical_panel[0].total_amps': '100',
            'electrical_panel[1].total_amps': '200',
        });
    });

    it('a slot nobody recorded still yields an explicit empty key', () => {
        // Same discipline as an unanswered item: the slot is PRINTED on the
        // form whether or not the house has a second panel, so the key exists
        // and the answer is empty. A missing key is what the renderer refuses
        // on for a required field, and that refusal is meant for a broken map.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '100' }] },
        );
        expect(Object.prototype.hasOwnProperty.call(values, 'electrical_panel[1].total_amps'))
            .toBe(true);
        expect(values['electrical_panel[1].total_amps']).toBe('');
    });

    it('REFUSES more instances than the form holds, naming both numbers and the destination', () => {
        expect(() => collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            {
                electrical_panel: [
                    { total_amps: '100' }, { total_amps: '200' }, { total_amps: '300' },
                ],
            },
        )).toThrow(
            'Electrical Panel: this inspection recorded 3, and this revision of the form '
            + 'has 2 slots. Record the remaining 1 in the narrative report or as an attachment.',
        );
    });

    it('POSITIVE CONTROL — exactly capacity is accepted', () => {
        // Without this the refusal above passes for a collector that refuses
        // every group it is handed.
        expect(() => collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '100' }, { total_amps: '200' }] },
        )).not.toThrow();
    });

    it('REFUSES a group whose slot names a binding also claims', () => {
        // Both routes write into one object, so the loser disappears without a
        // trace and the form carries whichever ran last.
        expect(() => collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: { 'electrical_panel[0].total_amps': { from: 'literal', value: '150' } },
                groups: [PANELS],
            },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '100' }] },
        )).toThrow(/electrical_panel\[0\]\.total_amps/);
    });

    it('a malformed group is refused before any value is collected', () => {
        expect(() => collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: {},
                groups: [{ ...PANELS, slotLabels: ['Main Panel'] }],
            },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS, { electrical_panel: [] },
        )).toThrow(/electrical_panel/);
    });
});

describe('collectStatutoryValues — a declaration with no groups is untouched', () => {
    it('behaves exactly as it did before groups existed', () => {
        // The ordinary case: the Florida wind-mitigation form declares no
        // repeated blocks at all. Nothing about this call may change.
        const values = collectStatutoryValues(DECL, SNAPSHOT, { itm_roof: { rating: 'D' } }, FACTS);
        expect(values).toEqual({ 'roof.covering': 'D' });
    });

    it('ignores recorded instances when the declaration declares no groups', () => {
        // Instances arrive from the inspection; groups are declared by the
        // template. A form with no repeated block has nowhere to put them, and
        // inventing keys here would produce values the map cannot place.
        const values = collectStatutoryValues(
            DECL, SNAPSHOT, { itm_roof: { rating: 'D' } }, FACTS,
            { electrical_panel: [{ total_amps: '100' }] },
        );
        expect(values).toEqual({ 'roof.covering': 'D' });
    });
});
