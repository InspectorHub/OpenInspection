import { describe, it, expect } from 'vitest';
import { refuseIndexInsidePrintedRange } from '../../../server/services/statutory/overflow.service';
import type { FieldGroup } from '../../../server/types/template-schema';

/**
 * Which instances may be recorded in the overflow store, and which may not.
 *
 * Storage and tenant scoping are covered by `overflow-instances.spec.ts`. What
 * is here is the one rule that store cannot enforce on its own: an instance
 * inside the printed range does not belong to it.
 */
const PANELS: FieldGroup = {
    id: 'electrical_panel',
    label: 'Electrical Panel',
    capacity: 2,
    slotLabels: ['Main Panel', 'Second Panel'],
    fields: ['total_amps'],
};

describe('refuseIndexInsidePrintedRange', () => {
    it('refuses a printed slot, and names it the way the form does', () => {
        // Index 1 is the Second Panel and its value comes from a binding, which
        // is the authority for it. A second writer would give one box two
        // sources with nothing to say which the form carried -- and the losing
        // value would not be missing, it would be invisible.
        expect(() => refuseIndexInsidePrintedRange(PANELS, 1)).toThrow(/Second Panel/);
    });

    it('refuses the first printed slot too', () => {
        expect(() => refuseIndexInsidePrintedRange(PANELS, 0)).toThrow(/Main Panel/);
    });

    it('accepts the first index past the printed range', () => {
        // Capacity 2 means slots 0 and 1 are printed; 2 is the third panel, and
        // the third panel is exactly what this store exists for.
        expect(() => refuseIndexInsidePrintedRange(PANELS, 2)).not.toThrow();
    });

    it('accepts an index further out still', () => {
        expect(() => refuseIndexInsidePrintedRange(PANELS, 5)).not.toThrow();
    });
});
