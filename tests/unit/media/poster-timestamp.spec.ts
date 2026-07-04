import { describe, it, expect } from 'vitest';
import { framesForDuration, pctFromSec, secFromPct } from '../../../server/lib/media/poster-timestamp';

describe('framesForDuration', () => {
    it('returns N evenly-spaced frames spanning the duration', () => {
        const frames = framesForDuration(24, 8);
        expect(frames).toHaveLength(8);
        expect(frames.map((f) => f.sec)).toEqual([0, 3, 6, 9, 12, 15, 18, 21]);
        expect(frames[0].pct).toBe(0);
        expect(frames[0].index).toBe(0);
        expect(frames[7].index).toBe(7);
        // last frame is strictly inside the clip (never at/over the end → no black tail frame)
        expect(frames[7].pct).toBeLessThan(1);
        expect(frames[7].pct).toBeCloseTo(21 / 24, 6);
    });

    it('clamps every frame pct into [0, 1)', () => {
        for (const f of framesForDuration(10, 8)) {
            expect(f.pct).toBeGreaterThanOrEqual(0);
            expect(f.pct).toBeLessThan(1);
        }
    });

    it('returns a single frame at pct 0 when duration is 0', () => {
        const frames = framesForDuration(0, 8);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toEqual({ index: 0, sec: 0, pct: 0 });
    });

    it('returns a single frame at pct 0 for Stream\'s unknown duration (-1)', () => {
        const frames = framesForDuration(-1, 8);
        expect(frames).toHaveLength(1);
        expect(frames[0]).toEqual({ index: 0, sec: 0, pct: 0 });
    });

    it('returns a single frame when count <= 1', () => {
        expect(framesForDuration(24, 1)).toEqual([{ index: 0, sec: 0, pct: 0 }]);
        expect(framesForDuration(24, 0)).toEqual([{ index: 0, sec: 0, pct: 0 }]);
    });
});

describe('pctFromSec', () => {
    it('converts seconds to a 0..1 fraction', () => {
        expect(pctFromSec(12, 24)).toBe(0.5);
        expect(pctFromSec(0, 24)).toBe(0);
    });

    it('clamps above 1 and below 0', () => {
        expect(pctFromSec(30, 24)).toBe(1);
        expect(pctFromSec(-1, 24)).toBe(0);
    });

    it('returns 0 for a non-positive duration (avoid divide-by-zero)', () => {
        expect(pctFromSec(5, 0)).toBe(0);
        expect(pctFromSec(5, -1)).toBe(0);
    });
});

describe('secFromPct', () => {
    it('is the inverse of pctFromSec', () => {
        expect(secFromPct(0.5, 24)).toBe(12);
        expect(secFromPct(0, 24)).toBe(0);
    });

    it('clamps pct into [0, 1] before scaling', () => {
        expect(secFromPct(2, 24)).toBe(24);
        expect(secFromPct(-1, 24)).toBe(0);
    });

    it('returns 0 for a non-positive duration', () => {
        expect(secFromPct(0.5, 0)).toBe(0);
        expect(secFromPct(0.5, -1)).toBe(0);
    });
});
