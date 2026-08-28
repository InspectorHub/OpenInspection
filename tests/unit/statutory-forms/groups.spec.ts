import { describe, it, expect } from 'vitest';
import type { FieldGroup } from '../../../server/types/template-schema';
import {
    validateGroups, groupFieldName, expectedGroupFields, refuseOverCapacity,
} from '../../../server/lib/statutory/groups';

describe('FieldGroup', () => {
    it('names every slot the form prints', () => {
        // Measured on the Citizens four-point form: it prints "Main Panel" and
        // "Second Panel". Position 0 is not "the first panel" -- it is the main one.
        const group: FieldGroup = {
            id: 'electrical_panel',
            label: 'Electrical Panel',
            capacity: 2,
            slotLabels: ['Main Panel', 'Second Panel'],
            fields: ['total_amps'],
        };
        expect(group.slotLabels).toHaveLength(group.capacity);
    });
});

const PANELS: FieldGroup = {
    id: 'electrical_panel', label: 'Electrical Panel', capacity: 2,
    slotLabels: ['Main Panel', 'Second Panel'], fields: ['total_amps'],
};

describe('validateGroups', () => {
    it('refuses slotLabels that do not match capacity', () => {
        expect(() => validateGroups([{ ...PANELS, slotLabels: ['Main Panel'] }]))
            .toThrow(/electrical_panel/);
    });
    it('refuses a duplicate group id', () => {
        expect(() => validateGroups([PANELS, PANELS])).toThrow(/electrical_panel/);
    });
    it('accepts a well-formed group', () => {
        expect(() => validateGroups([PANELS])).not.toThrow();
    });
});

describe('groupFieldName / expectedGroupFields', () => {
    it('addresses one instance positionally', () => {
        expect(groupFieldName('electrical_panel', 1, 'total_amps'))
            .toBe('electrical_panel[1].total_amps');
    });
    it('expands one name per slot', () => {
        expect(expectedGroupFields([PANELS]))
            .toEqual(['electrical_panel[0].total_amps', 'electrical_panel[1].total_amps']);
    });
});

describe('refuseOverCapacity', () => {
    it('names BOTH numbers and says where the extra goes', () => {
        // Read standing in a garage. An error that only says "too many" tells him
        // he is stuck; he needs the next step.
        expect(() => refuseOverCapacity(PANELS, 3)).toThrow(
            'Electrical Panel: this inspection recorded 3, and this revision of the form '
            + 'has 2 slots. Record the remaining 1 in the narrative report or as an attachment.',
        );
    });
    it('allows exactly capacity', () => {
        expect(() => refuseOverCapacity(PANELS, 2)).not.toThrow();
    });
    it('allows fewer than capacity', () => {
        expect(() => refuseOverCapacity(PANELS, 1)).not.toThrow();
    });
});
