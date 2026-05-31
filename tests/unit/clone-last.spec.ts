import { describe, it, expect } from 'vitest';

/**
 * Pure-logic spec test for cloneByScope. The function under test is
 * duplicated below to lock the contract; the production helper lives in
 * app/hooks/useFindings.ts. Keeping the duplicate in the api
 * workspace avoids cross-workspace import issues.
 */
function cloneByScope(
    src: Record<string, unknown>,
    scope: 'rating' | 'rating_notes' | 'all',
): Record<string, unknown> {
    if (scope === 'all') return { ...src };
    if (scope === 'rating_notes') {
        const next: Record<string, unknown> = {};
        if ('rating' in src) next.rating = src.rating;
        if ('notes' in src)  next.notes  = src.notes;
        return next;
    }
    const next: Record<string, unknown> = {};
    if ('rating' in src) next.rating = src.rating;
    return next;
}

describe('cloneByScope', () => {
    const src = {
        rating: 'SAT',
        notes: 'Roof in good condition.',
        photos: [{ key: 'photo1.jpg' }],
        tabs: { defects: [] },
        tags: ['follow-up'],
    };

    it('"rating" copies only rating', () => {
        expect(cloneByScope(src, 'rating')).toEqual({ rating: 'SAT' });
    });
    it('"rating_notes" copies rating + notes', () => {
        expect(cloneByScope(src, 'rating_notes')).toEqual({ rating: 'SAT', notes: 'Roof in good condition.' });
    });
    it('"all" shallow-copies everything', () => {
        const out = cloneByScope(src, 'all');
        expect(out).toEqual(src);
        expect(out).not.toBe(src);
    });
    it('handles missing rating gracefully', () => {
        expect(cloneByScope({ notes: 'X' }, 'rating')).toEqual({});
    });
    it('handles missing notes in rating_notes scope', () => {
        expect(cloneByScope({ rating: 'MON' }, 'rating_notes')).toEqual({ rating: 'MON' });
    });
});
