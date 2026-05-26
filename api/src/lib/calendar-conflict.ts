/**
 * Sprint 3 · S3-9 — Calendar drag-drop reschedule conflict detection.
 *
 * Pure helpers (no DOM, no fetch) so they can run in Vitest and inside the
 * browser-side `calendar.js` drag handler. The FullCalendar event list is
 * already loaded in memory when a drop happens, so this runs synchronously
 * in `eventAllow` / `eventDrop` without an extra round-trip.
 *
 * Time semantics:
 *   - "same hour" = same UTC year-month-day-hour. We deliberately use UTC
 *     (not local time) so the result is identical whether the test runs in
 *     CI (UTC) or on a developer's machine (local TZ). FullCalendar feeds us
 *     ISO strings produced by `Date#toISOString()` from the dragged event,
 *     which are already UTC.
 *   - YYYY-MM-DD strings (no time) are treated as full-day occupants — any
 *     drop on that calendar day conflicts. The `/api/calendar/events`
 *     endpoint returns inspections in this shape for the dayGridMonth view.
 */

export interface CalendarItem {
    id:   string;
    date: string;       // ISO 8601 datetime, or YYYY-MM-DD
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Returns true when both timestamps fall on the same UTC calendar day AND
 * the same UTC hour. If either side is a YYYY-MM-DD (no time), only the
 * calendar day must match — the day-only entry is treated as an all-day
 * occupant of the slot.
 *
 * Returns false on any unparsable input rather than throwing — the caller is
 * a drag-drop hot path and a thrown error would silently break the UI.
 */
export function sameDayHour(a: string, b: string): boolean {
    if (!a || !b) return false;

    const aDateOnly = DATE_ONLY_RE.test(a);
    const bDateOnly = DATE_ONLY_RE.test(b);

    const aDate = aDateOnly ? new Date(`${a}T00:00:00Z`) : new Date(a);
    const bDate = bDateOnly ? new Date(`${b}T00:00:00Z`) : new Date(b);

    if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) return false;

    const sameDay = aDate.getUTCFullYear() === bDate.getUTCFullYear()
        && aDate.getUTCMonth() === bDate.getUTCMonth()
        && aDate.getUTCDate()  === bDate.getUTCDate();

    if (!sameDay) return false;

    // If either side is day-only, the day match alone is a conflict.
    if (aDateOnly || bDateOnly) return true;

    return aDate.getUTCHours() === bDate.getUTCHours();
}

/**
 * Returns the first inspection that occupies the same UTC day+hour slot as
 * `targetDate`, or `null` when the slot is free. The inspection identified
 * by `ignoreId` is skipped — that's the inspection currently being dragged.
 *
 * Pure function: the caller passes the cached calendar payload, so this is
 * O(n) over inspections currently rendered in the FullCalendar viewport.
 */
export function detectSlotConflict<T extends CalendarItem>(
    inspections: ReadonlyArray<T>,
    targetDate:  string,
    ignoreId:    string,
): T | null {
    for (const ins of inspections) {
        if (ins.id === ignoreId) continue;
        if (sameDayHour(ins.date, targetDate)) return ins;
    }
    return null;
}
