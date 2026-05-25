import { describe, it, expect, vi, afterEach } from 'vitest';
import {
    mergeText,
    formatRelativeTime,
    isConflictResolved,
} from '../../public/js/conflict-resolver-helpers.js';

describe('conflict-resolver helpers (subsystem B phase 3 task 3.5)', () => {
    describe('mergeText', () => {
        it('concatenates with separator', () => {
            expect(mergeText('mine', 'theirs')).toBe('mine\n---\ntheirs');
        });

        it('returns the non-empty side when one is empty', () => {
            expect(mergeText('', 'theirs')).toBe('theirs');
            expect(mergeText('mine', '')).toBe('mine');
        });

        it('coerces non-string values to string', () => {
            expect(mergeText(42 as unknown as string, 'note')).toBe('42\n---\nnote');
            expect(mergeText(null as unknown as string, 'x')).toBe('x');
        });
    });

    describe('formatRelativeTime', () => {
        afterEach(() => vi.useRealTimers());

        it('returns Ns ago for sub-minute', () => {
            const now = 1_734_200_000;
            vi.useFakeTimers().setSystemTime(now * 1000);
            expect(formatRelativeTime(now - 30)).toBe('30s ago');
        });

        it('returns Nm ago for sub-hour', () => {
            const now = 1_734_200_000;
            vi.useFakeTimers().setSystemTime(now * 1000);
            expect(formatRelativeTime(now - 60)).toBe('1m ago');
            expect(formatRelativeTime(now - 7 * 60)).toBe('7m ago');
        });

        it('returns Nh ago for sub-day', () => {
            const now = 1_734_200_000;
            vi.useFakeTimers().setSystemTime(now * 1000);
            expect(formatRelativeTime(now - 3 * 3600)).toBe('3h ago');
        });

        it('returns ISO date for older than a day', () => {
            const now = Math.floor(new Date('2026-05-22T12:00:00Z').getTime() / 1000);
            vi.useFakeTimers().setSystemTime(now * 1000);
            const long_ago = now - 30 * 86_400;
            expect(formatRelativeTime(long_ago)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        });
    });

    describe('isConflictResolved', () => {
        it('true when action set', () => {
            expect(isConflictResolved({ action: 'keep-mine' })).toBe(true);
            expect(isConflictResolved({ action: 'keep-theirs' })).toBe(true);
            expect(isConflictResolved({ action: 'merge' })).toBe(true);
        });

        it('false when action null/undefined/missing', () => {
            expect(isConflictResolved({ action: null })).toBe(false);
            expect(isConflictResolved({ action: undefined })).toBe(false);
            expect(isConflictResolved({})).toBe(false);
        });
    });
});
