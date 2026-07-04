import { describe, it, expect } from 'vitest';

interface UsageRow { tenantId: string; userId: string; commentId: string; useCount: number; lastUsedAt: number | null }

function mergeTouch(existing: UsageRow | null, tenantId: string, userId: string, commentId: string, now: number): UsageRow {
    if (existing) {
        return { ...existing, useCount: existing.useCount + 1, lastUsedAt: now };
    }
    return { tenantId, userId, commentId, useCount: 1, lastUsedAt: now };
}

describe('mergeTouch', () => {
    it('inserts a new row when none exists', () => {
        const r = mergeTouch(null, 't1', 'u1', 'c1', 1000);
        expect(r).toEqual({ tenantId: 't1', userId: 'u1', commentId: 'c1', useCount: 1, lastUsedAt: 1000 });
    });

    it('increments useCount and updates lastUsedAt when row exists', () => {
        const existing: UsageRow = { tenantId: 't1', userId: 'u1', commentId: 'c1', useCount: 5, lastUsedAt: 500 };
        const r = mergeTouch(existing, 't1', 'u1', 'c1', 1000);
        expect(r).toEqual({ tenantId: 't1', userId: 'u1', commentId: 'c1', useCount: 6, lastUsedAt: 1000 });
    });
});
