/**
 * The value a non-rich item carries reaches the report through toReportItemValue. The result store types it as unknown, so the report
 * data must not hand on whatever happens to be stored: only the shapes the editor writes (string, number, boolean, list of strings).
 */
import { describe, it, expect } from 'vitest';
import { toReportItemValue } from '../../../server/lib/report-utils';

describe('toReportItemValue', () => {
    it.each([
        ['text', 'Asphalt shingle', 'Asphalt shingle'],
        ['an empty string (a cleared field is still a value the editor wrote)', '', ''],
        ['a number', 1995, 1995],
        ['zero', 0, 0],
        ['a yes or no', false, false],
        ['the choices of a multi-select written as a list', ['a', 'b'], ['a', 'b']],
        ['the choices of a multi-select as the web editor writes them (one comma-joined string)', 'Electric,Gas', 'Electric,Gas'],
        ['no choices', [], []],
    ])('keeps %s as it is', (_name, input, expected) => {
        expect(toReportItemValue(input)).toEqual(expected);
    });

    it.each([
        ['nothing stored', undefined],
        ['null', null],
        ['an object', { a: 1 }],
        ['a list holding something else', ['a', 2]],
        ['a list of lists', [['a']]],
        ['not a number', Number.NaN],
        ['infinity', Number.POSITIVE_INFINITY],
        ['a function', () => 1],
    ])('reports %s as null', (_name, input) => {
        expect(toReportItemValue(input)).toBeNull();
    });

    it('does not turn a falsy value into null (the control for the null cases above)', () => {
        expect(toReportItemValue(0)).toBe(0);
        expect(toReportItemValue(false)).toBe(false);
        expect(toReportItemValue('')).toBe('');
    });
});
