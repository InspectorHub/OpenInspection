import { describe, it, expect } from 'vitest';
import { formCompleteness } from '~/lib/editor/form-completeness';

/**
 * How much of the form is answered, computed from what the editor already has.
 *
 * Deliberately counts BOUND items only. An inspection may carry items no
 * binding points at, and counting those would move the number without moving
 * the form.
 */
const BOUND = new Set(['a', 'b', 'c']);

describe('formCompleteness', () => {
    it('counts a bound item as answered when it has a value or a rating', () => {
        const done = formCompleteness(BOUND, {
            '_default:s1:a': { value: 'Shingle' },
            '_default:s1:b': { rating: 'Satisfactory' },
        });
        expect(done).toEqual({ answered: 2, total: 3 });
    });

    it('does not count an empty string as an answer', () => {
        // A box someone cleared is not a box someone filled, and on a statutory
        // form the difference is the whole point.
        expect(formCompleteness(BOUND, { '_default:s1:a': { value: '' } }))
            .toEqual({ answered: 0, total: 3 });
    });

    it('ignores results for items no binding points at', () => {
        expect(formCompleteness(BOUND, { '_default:s1:zzz': { value: 'x' } }))
            .toEqual({ answered: 0, total: 3 });
    });

    it('counts an item once however many scopes carry it', () => {
        // Per-unit mode keys the same item under several unit scopes; the form
        // has one box for it either way.
        expect(formCompleteness(BOUND, {
            'u1:s1:a': { value: '1' },
            'u2:s1:a': { value: '2' },
        })).toEqual({ answered: 1, total: 3 });
    });

    it('is empty rather than zero-divided when nothing is bound', () => {
        expect(formCompleteness(new Set(), {})).toEqual({ answered: 0, total: 0 });
    });
});
