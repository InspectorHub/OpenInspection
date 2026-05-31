/**
 * Design System 0520 subsystem D phase 7 — version diff computer.
 *
 * Pure helper that walks two snapshot bundles and emits a flat
 * { items, units } diff payload consumed by /inspections/:id/versions/:n/diff.
 */
import { describe, it, expect } from 'vitest';
import { computeDiff } from '../../server/lib/version-diff';

describe('computeDiff (subsystem D P7)', () => {
    it('detects added item', () => {
        const from = { data: {}, units: [] };
        const to   = { data: { 'i-1': { rating: 'sat' } }, units: [] };
        expect(computeDiff(from, to).items).toEqual([{ itemId: 'i-1', kind: 'added' }]);
    });

    it('detects removed item', () => {
        const from = { data: { 'i-1': { rating: 'sat' } }, units: [] };
        const to   = { data: {}, units: [] };
        expect(computeDiff(from, to).items).toEqual([{ itemId: 'i-1', kind: 'removed' }]);
    });

    it('detects changed rating', () => {
        const from = { data: { 'i-1': { rating: 'sat' } }, units: [] };
        const to   = { data: { 'i-1': { rating: 'defect' } }, units: [] };
        const diff = computeDiff(from, to);
        expect(diff.items[0]).toMatchObject({
            itemId: 'i-1', field: 'rating', kind: 'changed', from: 'sat', to: 'defect',
        });
    });

    it('reports multiple changed fields per item', () => {
        const from = { data: { 'i-1': { rating: 'sat',    notes: 'fine' } }, units: [] };
        const to   = { data: { 'i-1': { rating: 'defect', notes: 'leak' } }, units: [] };
        const fields = computeDiff(from, to).items.map(i => i.field);
        expect(fields).toContain('rating');
        expect(fields).toContain('notes');
    });

    it('ignores _v/_by/_at metadata on diff', () => {
        const from = { data: { 'i-1': { rating: 'sat', rating_v: 1, rating_by: 'a' } }, units: [] };
        const to   = { data: { 'i-1': { rating: 'sat', rating_v: 2, rating_by: 'b' } }, units: [] };
        expect(computeDiff(from, to).items).toEqual([]);
    });

    it('detects unit additions + removals', () => {
        const from = { data: {}, units: [{ id: 'u-1', name: 'Building A', kind: 'building' }] };
        const to   = { data: {}, units: [{ id: 'u-2', name: 'Building B', kind: 'building' }] };
        const diff = computeDiff(from, to);
        expect(diff.units.added.map(u => u.id)).toEqual(['u-2']);
        expect(diff.units.removed.map(u => u.id)).toEqual(['u-1']);
    });

    it('empty inputs return empty diff', () => {
        const diff = computeDiff({ data: {}, units: [] }, { data: {}, units: [] });
        expect(diff.items).toEqual([]);
        expect(diff.units.added).toEqual([]);
        expect(diff.units.removed).toEqual([]);
    });
});
