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
    inspector_license_type: null,
    inspector_qualification: null,
    inspector_signature_date: null,
    owner_name: null,
    owner_email: null,
    owner_mailing_address: null,
    owner_home_phone: null,
    owner_work_phone: null,
    owner_cell_phone: null,
    employee_printed_name: null,
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
    inspector_license_type: null,
    inspector_qualification: null,
    inspector_signature_date: null,
    owner_name: null,
    owner_email: null,
    owner_mailing_address: null,
    owner_home_phone: null,
    owner_work_phone: null,
    owner_cell_phone: null,
    employee_printed_name: null,
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

    const DAMAGE: FieldGroup = {
        id: 'roof',
        label: 'Roof',
        capacity: 1,
        slotLabels: ['Predominant Roof'],
        fields: ['damage_signs'],
    };

    it('carries a slot answered with a list, instead of flattening it to "a,b"', () => {
        // The roof block's damage signs are a "check all that apply" on the
        // printed page, so an instance may hold several. Expansion used to run
        // every instance value through `String()`, which produced
        // "cracking,cupping_curling" -- a value that names no box, ticks
        // nothing, and is refused by name at render time.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_roof', bindings: {}, groups: [DAMAGE] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { roof: [{ damage_signs: ['cracking', 'cupping_curling'] }] },
        );
        expect(values['roof[0].damage_signs']).toEqual(['cracking', 'cupping_curling']);
        // Named explicitly: `toEqual` on the array would also be satisfied by a
        // renderer nobody fixed if the assertion above were ever loosened.
        expect(values['roof[0].damage_signs']).not.toBe('cracking,cupping_curling');
    });

    it('an instance that recorded an empty list answers nothing, not an empty list', () => {
        // Same rule `asAnswer` states for an item attribute: an empty array is
        // what a collector that found nothing produces, and "none of these" is
        // the empty string. The renderer refuses an empty array by name.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_roof', bindings: {}, groups: [DAMAGE] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { roof: [{ damage_signs: [] }] },
        );
        expect(values['roof[0].damage_signs']).toBe('');
    });

    it('POSITIVE CONTROL — a slot answered with one value is still a plain string', () => {
        // Without this, "carries a list" would pass just as well for a change
        // that wrapped every slot value in an array.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_roof', bindings: {}, groups: [DAMAGE] },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { roof: [{ damage_signs: 'cracking' }] },
        );
        expect(values['roof[0].damage_signs']).toBe('cracking');
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

    it('a binding onto a printed slot WINS over an instance, and neither is lost silently', () => {
        // Adjudicated 2026-08-28. This used to be a refusal, on the reasoning
        // that two writers of one key make the loser vanish. The reasoning held;
        // the premise expired. A printed slot is an ordinary template item now,
        // so its value arrives as a binding, and refusing that refused the
        // normal case. The order in `collectStatutoryValues` decides it: slots
        // are written from instances first, the binding loop overwrites them.
        const values = collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: { 'electrical_panel[0].total_amps': { from: 'literal', value: '150' } },
                groups: [PANELS],
            },
            EMPTY_SNAPSHOT, {}, EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '100' }] },
        );
        expect(values['electrical_panel[0].total_amps']).toBe('150');
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

/**
 * Where the extra panel goes — and why the refusal moved to the end of the chain.
 *
 * The refusal is not gone; it is last. An instance the slots cannot hold is
 * written into the field the form itself nominates, and only a destination that
 * cannot hold it either brings the refusal back. The forms are what decided
 * this: the Citizens four-point form prints "(use additional pages if needed)"
 * on its Additional Comments box, so the publisher has already answered "where
 * does the third panel go". Making the inspector retype it there by hand is the
 * work being removed.
 */
describe('collectStatutoryValues — overflow goes where the form nominates', () => {
    const PANELS_WITH_COMMENTS: FieldGroup = {
        id: 'electrical_panel',
        label: 'Electrical Panel',
        capacity: 2,
        slotLabels: ['Main Panel', 'Second Panel'],
        fields: ['total_amps', 'panel_age'],
        overflowTo: 'additional_comments',
    };

    /** The form's own comments box, as an item the inspector writes into. */
    const COMMENTS_SNAPSHOT = {
        schemaVersion: 2,
        sections: [{
            id: 'sec_general',
            title: 'General',
            items: [{ id: 'itm_comments', label: 'Additional Comments', type: 'textarea' }],
        }],
    } as unknown as TemplateSchemaV2;

    const THREE_PANELS = {
        electrical_panel: [
            { total_amps: '100', panel_age: '12' },
            { total_amps: '150', panel_age: '20' },
            { total_amps: '60', panel_age: '31' },
        ],
    };

    it('writes the third panel into that field instead of refusing', () => {
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS_WITH_COMMENTS] },
            COMMENTS_SNAPSHOT, {}, EMPTY_FACTS, THREE_PANELS,
        );
        // The line carries its own attribution: a reader of the comments box has
        // to be able to tell WHAT this is and WHICH instance it was, because
        // nothing around it on the page will say so.
        expect(values['additional_comments'])
            .toBe('Electrical Panel 3 — Total amps: 60; Panel age: 31.');
        // The slots still hold the instances they held. An overflow that also
        // shifted the numbered slots would put the wrong panel in the printed box.
        expect(values['electrical_panel[0].total_amps']).toBe('100');
        expect(values['electrical_panel[1].total_amps']).toBe('150');
    });

    it('APPENDS to what the inspector wrote, never replacing it', () => {
        // His words are the point and ours are the ledger, so his come first and
        // survive whole. He is also not looking at this box when he edits the
        // panel — the two are not on the same screen — so anything overwritten
        // here disappears where he cannot see it.
        const values = collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: { additional_comments: { from: 'item', itemId: 'itm_comments' } },
                groups: [PANELS_WITH_COMMENTS],
            },
            COMMENTS_SNAPSHOT,
            { itm_comments: { value: 'Third panel is in the detached garage, fed from the main.' } },
            EMPTY_FACTS, THREE_PANELS,
        );
        expect(values['additional_comments']).toBe(
            'Third panel is in the detached garage, fed from the main.\n'
            + 'Electrical Panel 3 — Total amps: 60; Panel age: 31.',
        );
    });

    it('REGRESSION LOCK — with no destination declared it still refuses, word for word', () => {
        // The Florida wind-mitigation form has no comments, notes, remarks or
        // explain field anywhere on it. "No destination" is a real form, not a
        // theoretical branch, and nothing about that path may have moved.
        expect(() => collectStatutoryValues(
            {
                formId: 'fl_oir_b1_1802',
                bindings: {},
                groups: [{ ...PANELS_WITH_COMMENTS, overflowTo: undefined }],
            },
            COMMENTS_SNAPSHOT, {}, EMPTY_FACTS, THREE_PANELS,
        )).toThrow(
            'Electrical Panel: this inspection recorded 3, and this revision of the form '
            + 'has 2 slots. Record the remaining 1 in the narrative report or as an attachment.',
        );
    });

    it('REFUSES when the destination cannot hold it either, naming both numbers and the destination', () => {
        expect(() => collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: {},
                groups: [{ ...PANELS_WITH_COMMENTS, overflowMaxLength: 40 }],
            },
            COMMENTS_SNAPSHOT, {}, EMPTY_FACTS, THREE_PANELS,
        )).toThrow(
            'Electrical Panel: this inspection recorded 3, and this revision of the form '
            + 'has 2 slots. The remaining 1 will not fit in "additional_comments" either: '
            + 'that box holds about 40 characters and would receive 51. Record the remainder '
            + 'in the narrative report or as an attachment.',
        );
    });

    it('POSITIVE CONTROL — a destination that does hold it is not refused', () => {
        // Without this the refusal above passes for an implementation that
        // refuses every declared destination.
        const values = collectStatutoryValues(
            {
                formId: 'fl_citizens_4point',
                bindings: {},
                groups: [{ ...PANELS_WITH_COMMENTS, overflowMaxLength: 80 }],
            },
            COMMENTS_SNAPSHOT, {}, EMPTY_FACTS, THREE_PANELS,
        );
        expect(values['additional_comments'])
            .toBe('Electrical Panel 3 — Total amps: 60; Panel age: 31.');
    });

    it('an overflow instance nobody answered still says it exists', () => {
        // The silent drop is the failure this subsystem exists to prevent, and a
        // line with no answers on it is still the difference between "there is a
        // third panel" and a page that never mentions one.
        const values = collectStatutoryValues(
            { formId: 'fl_citizens_4point', bindings: {}, groups: [PANELS_WITH_COMMENTS] },
            COMMENTS_SNAPSHOT, {}, EMPTY_FACTS,
            {
                electrical_panel: [
                    { total_amps: '100', panel_age: '12' },
                    { total_amps: '150', panel_age: '20' },
                    {},
                ],
            },
        );
        expect(values['additional_comments']).toBe('Electrical Panel 3 — no answers recorded.');
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

describe('printed slots come from bindings; instances carry only the overflow', () => {
    // Adjudicated 2026-08-28. The earlier rule -- a slot field must NOT also be
    // a binding -- was written when a statutory form was assumed to have its own
    // entry surface. Entry is now the ordinary inspection editor and the form is
    // a projection of it, so a printed slot necessarily comes from an item, and
    // an item's value necessarily arrives as a binding.
    const GROUP = {
        id: 'electrical_panel', label: 'Electrical Panel', capacity: 2,
        slotLabels: ['Main Panel', 'Second Panel'],
        fields: ['total_amps'],
        overflowTo: 'additional_comments',
        overflowMaxLength: 400,
    } as const;

    it('accepts a binding onto a printed slot, and uses its value', () => {
        const values = collectStatutoryValues(
            {
                formId: 'f',
                groups: [GROUP],
                bindings: {
                    'electrical_panel[0].total_amps': { from: 'literal', value: '150' },
                    'electrical_panel[1].total_amps': { from: 'literal', value: '100' },
                    additional_comments: { from: 'literal', value: '' },
                },
            },
            { schemaVersion: 2, sections: [] },
            {},
            EMPTY_FACTS,
            {},
        );
        expect(values['electrical_panel[0].total_amps']).toBe('150');
        expect(values['electrical_panel[1].total_amps']).toBe('100');
    });

    it('CONTROL — an instance still supplies a slot when no binding claims it', () => {
        // Without this, "bindings win" could just as well mean "instances are
        // ignored", and the overflow path would be dead while the tests passed.
        const values = collectStatutoryValues(
            { formId: 'f', groups: [GROUP], bindings: { additional_comments: { from: 'literal', value: '' } } },
            { schemaVersion: 2, sections: [] },
            {},
            EMPTY_FACTS,
            { electrical_panel: [{ total_amps: '150' }] },
        );
        expect(values['electrical_panel[0].total_amps']).toBe('150');
    });
});
