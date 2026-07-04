/**
 * Sprint 3 · S3-9 — Calendar drag-drop reschedule.
 *
 * Pure helper that decides whether dropping an inspection on a new date/hour
 * collides with another inspection on the same tenant's calendar.
 *
 * The function lives in `server/lib/calendar-conflict.ts` so it can be reused
 * from both the FullCalendar drag handler (eventDrop / eventAllow) and from
 * any future swap modal logic without pulling in the DOM.
 */

import { describe, it, expect } from 'vitest';
import {
    detectSlotConflict,
    sameDayHour,
    type CalendarItem,
} from '../../../server/lib/calendar-conflict';

const inspections: CalendarItem[] = [
    { id: 'a', date: '2026-06-15T09:00:00.000Z' },
    { id: 'b', date: '2026-06-15T13:00:00.000Z' },
    { id: 'c', date: '2026-06-16T09:00:00.000Z' },
    // Day-only entries (no time) — calendar-events API returns these for
    // FullCalendar dayGridMonth view because `inspections.date` may be stored
    // as plain `YYYY-MM-DD`.
    { id: 'd', date: '2026-06-17' },
];

describe('sameDayHour', () => {
    it('matches same UTC day + same hour', () => {
        expect(sameDayHour('2026-06-15T09:00:00.000Z', '2026-06-15T09:30:00.000Z')).toBe(true);
        expect(sameDayHour('2026-06-15T09:00:00.000Z', '2026-06-15T09:00:00.000Z')).toBe(true);
    });

    it('rejects different hour', () => {
        expect(sameDayHour('2026-06-15T09:00:00.000Z', '2026-06-15T10:00:00.000Z')).toBe(false);
    });

    it('rejects different day', () => {
        expect(sameDayHour('2026-06-15T09:00:00.000Z', '2026-06-16T09:00:00.000Z')).toBe(false);
    });

    it('treats YYYY-MM-DD inputs as same calendar day (any time)', () => {
        // Day-precision entries collide on any drop within the same day.
        expect(sameDayHour('2026-06-17', '2026-06-17T14:00:00.000Z')).toBe(true);
        expect(sameDayHour('2026-06-17', '2026-06-18T14:00:00.000Z')).toBe(false);
    });

    it('returns false for invalid input rather than throwing', () => {
        expect(sameDayHour('not-a-date', '2026-06-15T09:00:00.000Z')).toBe(false);
        expect(sameDayHour('', '')).toBe(false);
    });
});

describe('detectSlotConflict', () => {
    it('returns null when slot is free', () => {
        const result = detectSlotConflict(inspections, '2026-06-15T11:00:00.000Z', 'a');
        expect(result).toBeNull();
    });

    it('returns the conflicting inspection when a same-hour slot is taken', () => {
        // Drop inspection `c` on 2026-06-15 09:00 — collides with `a`.
        const result = detectSlotConflict(inspections, '2026-06-15T09:00:00.000Z', 'c');
        expect(result).not.toBeNull();
        expect(result?.id).toBe('a');
    });

    it('ignores the inspection being dragged itself (ignoreId)', () => {
        // Dropping `a` on its own current slot must not flag a conflict.
        const result = detectSlotConflict(inspections, '2026-06-15T09:00:00.000Z', 'a');
        expect(result).toBeNull();
    });

    it('treats day-only entries as full-day occupants', () => {
        // Inspection `d` is YYYY-MM-DD on 2026-06-17. Any 17th drop conflicts.
        const result = detectSlotConflict(inspections, '2026-06-17T14:00:00.000Z', 'a');
        expect(result?.id).toBe('d');
    });

    it('returns null for empty list', () => {
        expect(detectSlotConflict([], '2026-06-15T09:00:00.000Z', 'x')).toBeNull();
    });

    it('returns null when the only candidate is the dragged inspection', () => {
        const list: CalendarItem[] = [{ id: 'solo', date: '2026-06-15T09:00:00.000Z' }];
        expect(detectSlotConflict(list, '2026-06-15T09:00:00.000Z', 'solo')).toBeNull();
    });
});
