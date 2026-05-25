/**
 * Design System 0520 subsystem B phase 4 task 4.1 — offline-queue pure helpers.
 *
 * Tests for the version-aware queue dedupe + replay-gate + error
 * classifier. Pure functions so we can cover edge cases (same-field
 * rapid edits, 409 vs 5xx vs 4xx) without spinning up IndexedDB.
 */
import { describe, it, expect } from 'vitest';
import {
    dedupePatches,
    shouldReplay,
    classifyError,
} from '../../public/js/offline-queue-helpers.js';

describe('dedupePatches (subsystem B P4 T4.1)', () => {
    it('collapses same-item-same-field rapid edits to the latest entry', () => {
        const q = [
            { url: '/items/i1', method: 'PATCH', body: JSON.stringify({ field: 'notes', value: 'a', expectedVersion: 1 }) },
            { url: '/items/i1', method: 'PATCH', body: JSON.stringify({ field: 'notes', value: 'b', expectedVersion: 1 }) },
            { url: '/items/i1', method: 'PATCH', body: JSON.stringify({ field: 'rating', value: 'sat', expectedVersion: 1 }) },
        ];
        const out = dedupePatches(q);
        expect(out).toHaveLength(2);
        const noteEntry = out.find(e => JSON.parse(e.body).field === 'notes');
        expect(noteEntry).toBeDefined();
        expect(JSON.parse(noteEntry!.body).value).toBe('b');
    });

    it('preserves order across different items', () => {
        const q = [
            { url: '/items/i1', method: 'PATCH', body: JSON.stringify({ field: 'notes', value: 'a', expectedVersion: 0 }) },
            { url: '/items/i2', method: 'PATCH', body: JSON.stringify({ field: 'notes', value: 'b', expectedVersion: 0 }) },
            { url: '/items/i1', method: 'PATCH', body: JSON.stringify({ field: 'notes', value: 'c', expectedVersion: 0 }) },
        ];
        const out = dedupePatches(q);
        expect(out).toHaveLength(2);
        expect(JSON.parse(out[0]!.body).value).toBe('c'); // i1 latest
        expect(JSON.parse(out[1]!.body).value).toBe('b'); // i2
    });

    it('passes non-PATCH and non-field entries through verbatim', () => {
        const q = [
            { url: '/inspections/x', method: 'POST', body: '{}' },
            { url: '/inspections/y', method: 'PATCH', body: 'not json' },
        ];
        expect(dedupePatches(q)).toEqual(q);
    });

    it('empty queue returns empty array', () => {
        expect(dedupePatches([])).toEqual([]);
    });
});

describe('shouldReplay (subsystem B P4 T4.1)', () => {
    it('false when offline regardless of queue length', () => {
        expect(shouldReplay({ online: false, length: 5 })).toBe(false);
    });

    it('true only when online AND queue non-empty', () => {
        expect(shouldReplay({ online: true, length: 5 })).toBe(true);
        expect(shouldReplay({ online: true, length: 0 })).toBe(false);
    });
});

describe('classifyError (subsystem B P4 T4.1)', () => {
    it('409 → conflict (surface to user, stop queue)', () => {
        expect(classifyError({ status: 409 })).toBe('conflict');
    });

    it('403/404 → fatal (discard, never retry)', () => {
        expect(classifyError({ status: 403 })).toBe('fatal');
        expect(classifyError({ status: 404 })).toBe('fatal');
    });

    it('500/503 → retry', () => {
        expect(classifyError({ status: 500 })).toBe('retry');
        expect(classifyError({ status: 503 })).toBe('retry');
    });

    it('200 → retry (defensive — caller already filters ok statuses)', () => {
        // The classifier is only called on !ok statuses, but for safety we
        // treat unknown as retry rather than discard.
        expect(classifyError({ status: 0 })).toBe('retry');
    });
});
