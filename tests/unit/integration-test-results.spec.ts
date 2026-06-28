/**
 * integration-test-results — bounded-history prune logic.
 *
 * recordIntegrationTest keeps only the newest KEEP_PER_TARGET rows per
 * (tenant, target). The DB insert+delete is exercised by the route specs; here
 * we pin the pure decision (idsToPrune) that keeps the table bounded.
 */
import { describe, it, expect } from 'vitest';
import { idsToPrune, KEEP_PER_TARGET } from '../../server/lib/integration-test-results';

describe('idsToPrune', () => {
    it('keeps everything when at or under the cap', () => {
        expect(idsToPrune([], KEEP_PER_TARGET)).toEqual([]);
        expect(idsToPrune(['a', 'b', 'c'], KEEP_PER_TARGET)).toEqual([]);
        const exactlyFull = ['a', 'b', 'c', 'd', 'e'];
        expect(exactlyFull).toHaveLength(KEEP_PER_TARGET);
        expect(idsToPrune(exactlyFull, KEEP_PER_TARGET)).toEqual([]);
    });

    it('drops the oldest beyond the cap (input is newest-first)', () => {
        // newest-first: f and g are the two oldest → pruned.
        const rows = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
        expect(idsToPrune(rows, KEEP_PER_TARGET)).toEqual(['f', 'g']);
    });

    it('honours an arbitrary keep count', () => {
        expect(idsToPrune(['a', 'b', 'c', 'd'], 2)).toEqual(['c', 'd']);
        expect(idsToPrune(['a', 'b', 'c'], 0)).toEqual(['a', 'b', 'c']);
    });
});
