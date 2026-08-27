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
import type { StatutoryFormDeclaration, TemplateSchemaV2 } from '../../../server/types/template-schema';

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
