/**
 * Free-tier usage quotas (2026-07), Task 8 — pure threshold-detection helper
 * for the inspection-creation notice email (4/5 "one left", 5/5 "cap
 * reached"). No DB/KV/email involved here — see
 * `server/api/inspections/core.ts` for the wiring that reads the lifetime
 * counter post-create and fires the email through `sendQuotaThresholdNotice`.
 */
import { describe, it, expect } from 'vitest';
import { noticeFor } from '../../server/features/plan-quota/notice';

describe('noticeFor (free-tier inspection threshold notice)', () => {
    it('returns null below the warning threshold', () => {
        expect(noticeFor(0)).toBeNull();
        expect(noticeFor(1)).toBeNull();
        expect(noticeFor(3)).toBeNull();
    });

    it('returns 4 at the warning threshold (one free inspection left)', () => {
        expect(noticeFor(4)).toBe(4);
    });

    it('returns 5 at the cap', () => {
        expect(noticeFor(5)).toBe(5);
    });

    it('returns null past the cap — consumeInspection blocks further creates so this count is never re-observed, but the helper stays a safe no-op regardless', () => {
        expect(noticeFor(6)).toBeNull();
        expect(noticeFor(100)).toBeNull();
    });
});
