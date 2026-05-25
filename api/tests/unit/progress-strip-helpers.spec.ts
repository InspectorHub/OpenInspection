/**
 * Design System 0520 subsystem B phase 6 task 6.1 — ProgressStrip helpers.
 *
 * Pure functions tested in isolation so the donut + ETA + heat-map
 * factories stay trivially mockable. No DOM dependency.
 */
import { describe, it, expect } from 'vitest';
import {
    computeCompletion,
    etaMinutes,
    sectionHeatMap,
} from '../../public/js/progress-strip-helpers.js';

describe('computeCompletion (subsystem B P6 T6.1)', () => {
    const items = [
        { id: 'a', sectionId: 's1', rating: 'sat' },
        { id: 'b', sectionId: 's1', rating: null },
        { id: 'c', sectionId: 's2', rating: 'defect' },
        { id: 'd', sectionId: 's2', rating: null },
        { id: 'e', sectionId: 's2', rating: null },
    ];

    it('returns rated / total / percent', () => {
        expect(computeCompletion(items)).toEqual({ rated: 2, total: 5, percent: 40 });
    });

    it('treats undefined rating as unrated', () => {
        const out = computeCompletion([{ id: 'x' }, { id: 'y', rating: 'sat' }]);
        expect(out).toEqual({ rated: 1, total: 2, percent: 50 });
    });

    it('empty array gives 0% with no NaN', () => {
        expect(computeCompletion([])).toEqual({ rated: 0, total: 0, percent: 0 });
    });

    it('all rated → 100%', () => {
        const all = [{ id: 'a', rating: 'sat' }, { id: 'b', rating: 'sat' }];
        expect(computeCompletion(all).percent).toBe(100);
    });
});

describe('etaMinutes', () => {
    it('uses rolling-window average × remaining', () => {
        expect(etaMinutes([60, 50, 70], 3)).toBe(3);  // avg 60s × 3 = 180s = 3min
    });

    it('returns 0 when history empty', () => {
        expect(etaMinutes([], 5)).toBe(0);
    });

    it('returns 0 when remaining = 0', () => {
        expect(etaMinutes([60, 50], 0)).toBe(0);
    });

    it('rounds to nearest minute', () => {
        expect(etaMinutes([30, 30], 1)).toBe(1);   // 30s = 0.5min → 1 (round half-up)
        expect(etaMinutes([29, 29], 1)).toBe(0);   // 29s = 0.48 → 0
    });
});

describe('sectionHeatMap', () => {
    it('returns per-section rated/total/percent', () => {
        const items = [
            { id: 'a', sectionId: 's1', rating: 'sat' },
            { id: 'b', sectionId: 's1', rating: null },
            { id: 'c', sectionId: 's2', rating: 'defect' },
            { id: 'd', sectionId: 's2', rating: null },
            { id: 'e', sectionId: 's2', rating: null },
        ];
        const out = sectionHeatMap(items);
        expect(out).toEqual([
            { sectionId: 's1', rated: 1, total: 2, percent: 50 },
            { sectionId: 's2', rated: 1, total: 3, percent: 33 },
        ]);
    });

    it('empty input returns empty array', () => {
        expect(sectionHeatMap([])).toEqual([]);
    });

    it('preserves section iteration order from input', () => {
        const items = [
            { id: 'a', sectionId: 'z', rating: 'sat' },
            { id: 'b', sectionId: 'a', rating: null },
        ];
        const out = sectionHeatMap(items);
        expect(out.map(s => s.sectionId)).toEqual(['z', 'a']);
    });
});
