/**
 * `toReportItemValue` normalises the captured value of an item before it is placed in the report payload. The report content hash (the
 * basis of the PDF cache and of a stored courtesy translation's freshness) is taken over that payload, so the question is which stored
 * values change the hash. The value is not one of the translatable leaf fields, so the translation spans are not affected either; only
 * the content hash can move.
 *
 * Before: `value: stored ?? null`. After: `value: toReportItemValue(stored)`.
 */
import { describe, it, expect } from 'vitest';
import { reportContentHash } from '../../../server/services/inspection/report-grain';
import { toReportItemValue } from '../../../server/lib/report-utils';

const payload = (value: unknown) => ({ sections: [{ id: 's1', items: [{ id: 'i1', rating: null, notes: null, value }] }] });
const before = (stored: unknown) => reportContentHash(payload(stored ?? null));
const after = (stored: unknown) => reportContentHash(payload(toReportItemValue(stored)));

describe('the content hash of a report across toReportItemValue', () => {
    it.each([
        ['a string', 'Intact'],
        ['an empty string', ''],
        ['a comma-separated multi-select string', 'a, b, c'],
        ['an integer', 3],
        ['zero', 0],
        ['a fraction', 4.5],
        ['true', true],
        ['false', false],
        ['a list of strings', ['a', 'b']],
        ['an empty list', []],
        ['null', null],
        ['undefined', undefined],
        // A non-finite number serialises as null in the hash basis whether or not it is normalised first.
        ['NaN', Number.NaN],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('does not move for %s', async (_kind, stored) => {
        expect(await after(stored)).toBe(await before(stored));
    });

    it.each([
        ['a list that holds a number', ['a', 1]],
        ['a list of numbers', [1, 2]],
        ['a nested list', [['a']]],
        ['an object', { choice: 'a' }],
        ['a date', new Date(0)],
    ])('moves for %s, which the editor does not write and the report did not state before as a value', async (_kind, stored) => {
        expect(await after(stored)).not.toBe(await before(stored));
    });

    it('control: the hash does depend on the value, so equality above is meaningful', async () => {
        expect(await after('a')).not.toBe(await after('b'));
    });
});
