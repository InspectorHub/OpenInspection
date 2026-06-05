/**
 * Unit tests for the shouldQueue predicate (app/lib/offline/should-queue.ts).
 *
 * shouldQueue(navigatorLike) returns true ONLY when the navigator is defined
 * AND reports onLine === false.
 */

import { describe, it, expect } from 'vitest';
import { shouldQueue } from '~/lib/offline/should-queue';

describe('shouldQueue', () => {
    // ── 1. undefined navigator → false ───────────────────────────────────────
    it('returns false when navigator is undefined (SSR / test env)', () => {
        expect(shouldQueue(undefined)).toBe(false);
    });

    // ── 2. onLine: true → false ───────────────────────────────────────────────
    it('returns false when navigator.onLine is true (device is online)', () => {
        expect(shouldQueue({ onLine: true })).toBe(false);
    });

    // ── 3. onLine: false → true ───────────────────────────────────────────────
    it('returns true when navigator.onLine is false (device is offline)', () => {
        expect(shouldQueue({ onLine: false })).toBe(true);
    });
});
