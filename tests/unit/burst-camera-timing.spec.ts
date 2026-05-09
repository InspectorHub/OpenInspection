/**
 * S3-6 — burst-camera timing helpers.
 *
 * The DOM-bound modal is exercised manually (Playwright can't reliably
 * fake `getUserMedia`), but the pure timing logic that decides
 * single-shot vs burst, computes frame counts, and caps the maximum is
 * unit-testable in isolation.
 */
import { describe, it, expect } from 'vitest';
import {
    LONG_PRESS_MS,
    BURST_FPS,
    MAX_BURST_FRAMES,
    BURST_INTERVAL_MS,
    burstFrameCount,
} from '../../public/js/burst-camera.js';

describe('S3-6 — burst-camera timing constants', () => {
    it('uses sensible defaults', () => {
        expect(LONG_PRESS_MS).toBe(200);
        expect(BURST_FPS).toBe(10);
        expect(MAX_BURST_FRAMES).toBe(30);
        expect(BURST_INTERVAL_MS).toBe(100);
    });
});

describe('S3-6 — burstFrameCount(heldMs)', () => {
    it('returns 0 for negative or non-numeric input', () => {
        expect(burstFrameCount(-1)).toBe(0);
        // @ts-expect-error testing invalid input
        expect(burstFrameCount(null)).toBe(0);
        // @ts-expect-error testing invalid input
        expect(burstFrameCount('abc')).toBe(0);
    });

    it('treats a quick tap as a single shot', () => {
        // Below LONG_PRESS_MS = single-shot intent.
        expect(burstFrameCount(0)).toBe(1);
        expect(burstFrameCount(50)).toBe(1);
        expect(burstFrameCount(LONG_PRESS_MS - 1)).toBe(1);
    });

    it('produces the first burst frame at exactly LONG_PRESS_MS', () => {
        // First burst frame fires at the threshold, then one every 100 ms.
        expect(burstFrameCount(LONG_PRESS_MS)).toBe(1 + Math.floor(LONG_PRESS_MS / BURST_INTERVAL_MS));
    });

    it('grows linearly with held time', () => {
        // 200 ms = 1 + 2 = 3 frames; 300 ms = 4; 1000 ms = 11.
        expect(burstFrameCount(200)).toBe(3);
        expect(burstFrameCount(300)).toBe(4);
        expect(burstFrameCount(1000)).toBe(11);
        expect(burstFrameCount(2000)).toBe(21);
    });

    it('caps at MAX_BURST_FRAMES regardless of how long the press lasts', () => {
        // 30 frames = 1 + 30 = at 3000 ms; longer holds must not overflow.
        expect(burstFrameCount(3000)).toBe(MAX_BURST_FRAMES);
        expect(burstFrameCount(10_000)).toBe(MAX_BURST_FRAMES);
        expect(burstFrameCount(60_000)).toBe(MAX_BURST_FRAMES);
    });

    it('never exceeds the documented 10 fps cap', () => {
        // For any held duration, frames-per-second derived from the helper
        // must stay <= BURST_FPS — otherwise we'd risk overrunning the
        // canvas + toBlob pipeline on low-end mobile.
        for (const ms of [200, 500, 1000, 2500, 4000]) {
            const frames = burstFrameCount(ms);
            const fps = (frames - 1) / (ms / 1000);
            expect(fps).toBeLessThanOrEqual(BURST_FPS + 0.01);
        }
    });
});
