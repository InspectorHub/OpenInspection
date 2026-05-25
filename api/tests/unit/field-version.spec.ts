/**
 * Design System 0520 subsystem B phase 3 — field-version conflict helpers.
 *
 * Tests the pure decision function that the patchItem / patchPropertyFact
 * service methods delegate to. Isolating this logic lets us cover the 8+
 * branches (legacy field, version match, stale, force override, missing
 * item) without spinning up an in-memory D1 fixture for each case.
 */
import { describe, it, expect } from 'vitest';
import { decideFieldWrite, applyFieldWrite } from '../../src/lib/field-version';

describe('decideFieldWrite (subsystem B phase 3)', () => {
    it('returns ok when versions match', () => {
        const cur = { rating: 'sat', rating_v: 2 };
        const out = decideFieldWrite(cur, 'rating', 'defect', 2);
        expect(out.kind).toBe('ok');
    });

    it('returns conflict when expectedVersion is stale', () => {
        const cur = { rating: 'sat', rating_v: 2, rating_by: 'user-a', rating_at: 1700 };
        const out = decideFieldWrite(cur, 'rating', 'defect', 1);
        expect(out.kind).toBe('conflict');
        if (out.kind === 'conflict') {
            expect(out.current).toEqual({ value: 'sat', by: 'user-a', at: 1700, v: 2 });
            expect(out.yours).toEqual({ value: 'defect', expectedVersion: 1 });
        }
    });

    it('treats legacy field without _v as version 0', () => {
        const cur = { rating: 'sat' };
        const out = decideFieldWrite(cur, 'rating', 'defect', 0);
        expect(out.kind).toBe('ok');
    });

    it('legacy field rejects expectedVersion > 0', () => {
        const cur = { rating: 'sat' };
        const out = decideFieldWrite(cur, 'rating', 'defect', 5);
        expect(out.kind).toBe('conflict');
    });

    it('force=true bypasses version check', () => {
        const cur = { rating: 'sat', rating_v: 5 };
        const out = decideFieldWrite(cur, 'rating', 'defect', 1, { force: true });
        expect(out.kind).toBe('ok');
    });

    it('missing item entry returns ok at version 0', () => {
        const out = decideFieldWrite(undefined, 'rating', 'sat', 0);
        expect(out.kind).toBe('ok');
    });
});

describe('applyFieldWrite (subsystem B phase 3)', () => {
    it('writes value + bumps version + stamps by/at', () => {
        const cur = { rating: 'sat', rating_v: 2 };
        const out = applyFieldWrite(cur, 'rating', 'defect', 'user-z', 1700);
        expect(out).toEqual({
            entry: { rating: 'defect', rating_v: 3, rating_by: 'user-z', rating_at: 1700 },
            newVersion: 3,
        });
    });

    it('initialises entry when previously absent', () => {
        const out = applyFieldWrite(undefined, 'rating', 'sat', 'user-z', 1700);
        expect(out.newVersion).toBe(1);
        expect(out.entry).toEqual({ rating: 'sat', rating_v: 1, rating_by: 'user-z', rating_at: 1700 });
    });

    it('preserves sibling fields on partial write', () => {
        const cur = { rating: 'sat', rating_v: 2, notes: 'looks good', notes_v: 1, notes_by: 'u-a', notes_at: 1690 };
        const out = applyFieldWrite(cur, 'notes', 'rusty hinge', 'user-z', 1700);
        expect(out.entry.rating).toBe('sat');
        expect(out.entry.rating_v).toBe(2);
        expect(out.entry.notes).toBe('rusty hinge');
        expect(out.entry.notes_v).toBe(2);
    });
});
