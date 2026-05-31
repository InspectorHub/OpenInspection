import { describe, it, expect } from 'vitest';
import {
    matchesInspectionFilter,
    countByFilter,
    INSPECTION_FILTERS,
    type FilterableInspection,
} from '../../server/lib/inspection-filter';

/**
 * Competitor parity Feature C1 — time-based inspection filter tabs.
 * Pure-function unit tests for the dashboard filter helpers.
 */
describe('inspection-filter', () => {
    // Pinned reference "now" — Wednesday 2026-05-13 12:00 local.
    const now = new Date(2026, 4, 13, 12, 0, 0); // month is 0-indexed

    function makeInsp(date: string | null, status = 'scheduled'): FilterableInspection {
        return { id: 'i1', date, status };
    }

    describe('matchesInspectionFilter', () => {
        it('all returns true regardless of date / status', () => {
            expect(matchesInspectionFilter(makeInsp(null), 'all', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-13'), 'all', now)).toBe(true);
            expect(matchesInspectionFilter({ status: 'cancelled' }, 'all', now)).toBe(true);
        });

        it('today matches inspection scheduled today', () => {
            expect(matchesInspectionFilter(makeInsp('2026-05-13'), 'today', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-12'), 'today', now)).toBe(false);
            expect(matchesInspectionFilter(makeInsp('2026-05-14'), 'today', now)).toBe(false);
        });

        it('yesterday and tomorrow are exact-day matches', () => {
            expect(matchesInspectionFilter(makeInsp('2026-05-12'), 'yesterday', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-14'), 'tomorrow', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-11'), 'yesterday', now)).toBe(false);
        });

        it('past matches all dates strictly before today', () => {
            expect(matchesInspectionFilter(makeInsp('2026-05-12'), 'past', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2025-12-01'), 'past', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-13'), 'past', now)).toBe(false);
            expect(matchesInspectionFilter(makeInsp('2026-05-14'), 'past', now)).toBe(false);
        });

        it('this_week matches Sun-Sat of the current calendar week', () => {
            // 2026-05-13 (Wed). Week = Sun 5/10 .. Sat 5/16.
            expect(matchesInspectionFilter(makeInsp('2026-05-10'), 'this_week', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-13'), 'this_week', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-16'), 'this_week', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-09'), 'this_week', now)).toBe(false);
            expect(matchesInspectionFilter(makeInsp('2026-05-17'), 'this_week', now)).toBe(false);
        });

        it('future matches dates beyond the end of this week', () => {
            // After Sat 5/16.
            expect(matchesInspectionFilter(makeInsp('2026-05-17'), 'future', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-06-01'), 'future', now)).toBe(true);
            expect(matchesInspectionFilter(makeInsp('2026-05-16'), 'future', now)).toBe(false);
            expect(matchesInspectionFilter(makeInsp('2026-05-13'), 'future', now)).toBe(false);
        });

        it('unconfirmed matches scheduled and draft, never in_progress / cancelled', () => {
            expect(matchesInspectionFilter({ status: 'scheduled' }, 'unconfirmed', now)).toBe(true);
            expect(matchesInspectionFilter({ status: 'draft' }, 'unconfirmed', now)).toBe(true);
            expect(matchesInspectionFilter({ status: 'in_progress' }, 'unconfirmed', now)).toBe(false);
            expect(matchesInspectionFilter({ status: 'completed' }, 'unconfirmed', now)).toBe(false);
            expect(matchesInspectionFilter({ status: 'cancelled' }, 'unconfirmed', now)).toBe(false);
        });

        it('in_progress matches only in_progress status', () => {
            expect(matchesInspectionFilter({ status: 'in_progress' }, 'in_progress', now)).toBe(true);
            expect(matchesInspectionFilter({ status: 'IN_PROGRESS' }, 'in_progress', now)).toBe(true);
            expect(matchesInspectionFilter({ status: 'scheduled' }, 'in_progress', now)).toBe(false);
        });

        it('non-status filters return false when date is missing', () => {
            const noDate: FilterableInspection = { status: 'scheduled' };
            expect(matchesInspectionFilter(noDate, 'today', now)).toBe(false);
            expect(matchesInspectionFilter(noDate, 'past', now)).toBe(false);
            expect(matchesInspectionFilter(noDate, 'this_week', now)).toBe(false);
        });

        it('accepts ISO timestamps and Date objects', () => {
            expect(matchesInspectionFilter({ date: new Date(2026, 4, 13, 9, 0) }, 'today', now)).toBe(true);
            expect(matchesInspectionFilter({ date: '2026-05-13T15:30:00Z' }, 'today', now)).toBe(true);
        });
    });

    describe('countByFilter', () => {
        it('returns correct counts across all buckets', () => {
            const list: FilterableInspection[] = [
                makeInsp('2026-05-13', 'scheduled'),    // today, unconfirmed
                makeInsp('2026-05-13', 'in_progress'),  // today, in_progress
                makeInsp('2026-05-12', 'scheduled'),    // yesterday, past, unconfirmed
                makeInsp('2026-05-14', 'scheduled'),    // tomorrow, this_week, unconfirmed
                makeInsp('2026-06-01', 'scheduled'),    // future, unconfirmed
            ];
            const counts = countByFilter(list, now);
            expect(counts.all).toBe(5);
            expect(counts.today).toBe(2);
            expect(counts.yesterday).toBe(1);
            expect(counts.tomorrow).toBe(1);
            expect(counts.past).toBe(1);
            expect(counts.future).toBe(1);
            expect(counts.in_progress).toBe(1);
            expect(counts.unconfirmed).toBe(4);
            // this_week covers Sun 5/10..Sat 5/16 → today×2, yesterday, tomorrow.
            expect(counts.this_week).toBe(4);
        });

        it('returns zeros for an empty list', () => {
            const counts = countByFilter([], now);
            for (const f of INSPECTION_FILTERS) {
                expect(counts[f.id]).toBe(0);
            }
        });
    });

    it('exposes filters in spec order', () => {
        const ids = INSPECTION_FILTERS.map(f => f.id);
        expect(ids).toEqual([
            'all', 'past', 'yesterday', 'today', 'tomorrow',
            'this_week', 'future', 'unconfirmed', 'in_progress',
        ]);
    });
});
