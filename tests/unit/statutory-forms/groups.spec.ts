import { describe, it, expect } from 'vitest';
import type { FieldGroup } from '../../../server/types/template-schema';

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
