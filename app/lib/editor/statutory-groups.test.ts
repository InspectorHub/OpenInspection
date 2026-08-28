import { describe, it, expect } from 'vitest';
import {
    deriveEditorGroups,
    formBoundItemIds,
} from '~/lib/editor/statutory-groups';
import type { StatutoryFormDeclaration } from '../../../server/types/template-schema';

/**
 * A declaration shaped like the Citizens four-point form: two printed panel
 * slots, each holding the same field set, plus one ordinary bound field that
 * belongs to no group.
 */
const DECLARATION: StatutoryFormDeclaration = {
    formId: 'fl_citizens_4point',
    groups: [{
        id: 'electrical_panel',
        label: 'Electrical Panel',
        capacity: 2,
        slotLabels: ['Main Panel', 'Second Panel'],
        fields: ['type', 'total_amps'],
        overflowTo: 'additional_comments',
    }],
    bindings: {
        'electrical_panel[0].type': { from: 'item', itemId: 'panel_main_type' },
        'electrical_panel[0].total_amps': { from: 'item', itemId: 'panel_main_amps' },
        'electrical_panel[1].type': { from: 'item', itemId: 'panel_second_type' },
        'electrical_panel[1].total_amps': { from: 'item', itemId: 'panel_second_amps' },
        additional_comments: { from: 'item', itemId: 'comments' },
        inspection_date: { from: 'inspection', field: 'inspection_date' },
    },
};

describe('deriveEditorGroups', () => {
    it('reads the printed slots straight out of the bindings', () => {
        // The whole point: nothing new has to be stored for the slots the form
        // prints. The binding key already says which item holds which field of
        // which slot.
        const [group] = deriveEditorGroups(DECLARATION);
        expect(group.id).toBe('electrical_panel');
        expect(group.slots).toHaveLength(2);
        expect(group.slots[0]).toEqual({
            index: 0,
            label: 'Main Panel',
            fields: { type: 'panel_main_type', total_amps: 'panel_main_amps' },
        });
        expect(group.slots[1].label).toBe('Second Panel');
        expect(group.slots[1].fields.total_amps).toBe('panel_second_amps');
    });

    it('carries the slot names the form prints, not indices', () => {
        // "Main" and "Second" are what the reader of the form sees; position 0
        // is not "the first panel", it is the main one.
        const [group] = deriveEditorGroups(DECLARATION);
        expect(group.slots.map((s) => s.label)).toEqual(['Main Panel', 'Second Panel']);
    });

    it('carries the overflow destination so the editor can say where extras go', () => {
        expect(deriveEditorGroups(DECLARATION)[0].overflowTo).toBe('additional_comments');
    });

    it('returns nothing when the declaration has no groups', () => {
        // The Florida wind-mitigation form has none at all.
        expect(deriveEditorGroups({ formId: 'f', bindings: {} })).toEqual([]);
    });

    it('omits a slot field the map has not bound yet', () => {
        // A half-authored map must not crash the editor. What is bound renders;
        // what is missing is the fidelity gate's problem, not this function's.
        const partial: StatutoryFormDeclaration = {
            ...DECLARATION,
            bindings: { 'electrical_panel[0].type': { from: 'item', itemId: 'panel_main_type' } },
        };
        const [group] = deriveEditorGroups(partial);
        expect(group.slots[0].fields).toEqual({ type: 'panel_main_type' });
        expect(group.slots[1].fields).toEqual({});
    });

    it('ignores a binding that resolves somewhere other than an item', () => {
        // `from: 'inspection'` resolves at render time from a column; there is
        // no template item for the editor to point at.
        const viaInspection: StatutoryFormDeclaration = {
            ...DECLARATION,
            bindings: {
                'electrical_panel[0].type': { from: 'literal', value: 'Circuit breaker' },
            },
        };
        expect(deriveEditorGroups(viaInspection)[0].slots[0].fields).toEqual({});
    });
});

describe('formBoundItemIds', () => {
    it('lists every item some binding points at', () => {
        expect(formBoundItemIds(DECLARATION)).toEqual(new Set([
            'panel_main_type', 'panel_main_amps',
            'panel_second_type', 'panel_second_amps',
            'comments',
        ]));
    });

    it('is empty for a template that declares no form', () => {
        // Which is what keeps a narrative template's editor unchanged.
        expect(formBoundItemIds(undefined)).toEqual(new Set());
    });
});
