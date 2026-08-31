/**
 * The six categories the profile screen offers must be the six the published
 * map can tick a box for.
 *
 * ⚠️ EVERY ASSERTION IS AGAINST THE MAP, NEVER AGAINST A LITERAL COPIED OUT OF
 * THE LIST UNDER TEST. A spec that spelled the six values out again would agree
 * with itself and disagree with the form: the same author would have typed both
 * sides in the same sitting, and a typo would travel to both.
 */
import { describe, it, expect } from 'vitest';
import { fieldMap } from '../../../server/lib/statutory/forms/fl-oir-b1-1802';
import {
    FL_1802_QUALIFICATION_CATEGORIES,
    FL_1802_QUALIFICATION_PROMPT,
} from '../../../server/lib/statutory/qualification-categories';

/** The mappings that tick a qualification box, in the order the file declares. */
const boxes = fieldMap.mappings.filter(
    (mapping): mapping is Extract<typeof mapping, { kind: 'checkbox' }> =>
        mapping.kind === 'checkbox' && mapping.ourField === 'inspector_qualification',
);

describe('FL_1802_QUALIFICATION_CATEGORIES', () => {
    it('finds the qualification boxes at all', () => {
        // Without this, every comparison below is between two empty lists and
        // passes by saying nothing. The number is the form's: six boxes under
        // "(check one)".
        expect(boxes.length).toBe(6);
    });

    it('offers exactly the values the map ticks a box for, in both directions', () => {
        const offered = FL_1802_QUALIFICATION_CATEGORIES.map((c) => c.value);
        const ticked = boxes.map((b) => b.whenValue);
        expect([...offered].sort()).toEqual([...ticked].sort());
    });

    it('lists them in the order the page prints them, top to bottom', () => {
        // The page's order is the y coordinate, descending: a PDF's origin is
        // the bottom-left corner, so the box nearest the top has the largest y.
        // Asserting against the geometry rather than against the order the map
        // file happens to declare means a reordered map cannot quietly reorder
        // what an inspector reads.
        const topToBottom = [...boxes]
            .sort((a, b) => b.y - a.y)
            .map((b) => b.whenValue);
        expect(FL_1802_QUALIFICATION_CATEGORIES.map((c) => c.value)).toEqual(topToBottom);
    });

    it('keeps the printed sentence and the stored value apart', () => {
        // Storing the label would tick no box and print an empty form, which is
        // the failure this subsystem exists to prevent. The two must never be
        // interchangeable, so no label may equal a value and none may be blank.
        const values = new Set(FL_1802_QUALIFICATION_CATEGORIES.map((c) => c.value));
        for (const category of FL_1802_QUALIFICATION_CATEGORIES) {
            expect(category.printedAs.trim().length).toBeGreaterThan(0);
            expect(values.has(category.printedAs)).toBe(false);
            // A value reaches a byte-for-byte comparison against `whenValue`;
            // anything a form control could mangle does not belong in one.
            expect(category.value).toMatch(/^[a-z0-9_]+$/);
        }
    });

    it('carries the prompt the form prints above the boxes', () => {
        expect(FL_1802_QUALIFICATION_PROMPT).toContain('(check one)');
    });
});
