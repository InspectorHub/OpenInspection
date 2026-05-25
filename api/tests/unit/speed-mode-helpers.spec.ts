import { describe, it, expect } from 'vitest';
import {
    buildSpeedQueue,
    nextUnratedIndex,
    isQueueExhausted,
} from '../../public/js/speed-mode-helpers.js';

describe('SpeedMode helpers', () => {
    const items = [
        { id: 'a', rating: null },
        { id: 'b', rating: 'sat' },
        { id: 'c', rating: null },
        { id: 'd', rating: 'defect' },
        { id: 'e', rating: null },
    ];

    it('buildSpeedQueue returns indices of unrated items only', () => {
        expect(buildSpeedQueue(items)).toEqual([0, 2, 4]);
    });

    it('buildSpeedQueue treats undefined rating same as null', () => {
        const mixed = [{ id: 'x' }, { id: 'y', rating: 'sat' }];
        expect(buildSpeedQueue(mixed)).toEqual([0]);
    });

    it('buildSpeedQueue returns empty for empty input', () => {
        expect(buildSpeedQueue([])).toEqual([]);
    });

    it('nextUnratedIndex returns current+1 when valid', () => {
        expect(nextUnratedIndex([0, 2, 4], 0)).toBe(1);
        expect(nextUnratedIndex([0, 2, 4], 1)).toBe(2);
    });

    it('nextUnratedIndex returns -1 at end of queue', () => {
        expect(nextUnratedIndex([0, 2, 4], 2)).toBe(-1);
        expect(nextUnratedIndex([], 0)).toBe(-1);
    });

    it('isQueueExhausted true when current >= queue.length - 1', () => {
        expect(isQueueExhausted([0, 2], 1)).toBe(true);
        expect(isQueueExhausted([0, 2], 0)).toBe(false);
        expect(isQueueExhausted([], 0)).toBe(true);
    });
});
