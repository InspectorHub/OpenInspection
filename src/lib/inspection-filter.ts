/**
 * Inspection list time-filter helpers — Competitor parity Feature C1.
 *
 * Pure utility functions used by the dashboard to filter the inspection list
 * by time bucket and status. The dashboard (Alpine `dashboard()` factory)
 * imports these via the bundled JS shim (public/js/dashboard.js).
 *
 * The filter ids match the Spectora App.E.7 spec:
 *   ALL / PAST / YESTERDAY / TODAY / TOMORROW / THIS WEEK / FUTURE /
 *   UNCONFIRMED / IN PROGRESS
 *
 * All date math runs in the browser's local timezone — the inspection
 * `date` column is stored as `YYYY-MM-DD` (UTC midnight) but inspectors
 * read the dashboard in their own day. Filters use day-level granularity
 * (Date.toDateString()) so a noon-UTC inspection still shows under "today"
 * for an inspector in PT.
 */

export type InspectionFilter =
    | 'all'
    | 'past'
    | 'yesterday'
    | 'today'
    | 'tomorrow'
    | 'this_week'
    | 'future'
    | 'unconfirmed'
    | 'in_progress';

/** All filter ids in tab-render order. Exported so the UI can render the
 *  exact same set without drift. */
export const INSPECTION_FILTERS: ReadonlyArray<{ id: InspectionFilter; label: string }> = [
    { id: 'all',         label: 'All' },
    { id: 'past',        label: 'Past' },
    { id: 'yesterday',   label: 'Yesterday' },
    { id: 'today',       label: 'Today' },
    { id: 'tomorrow',    label: 'Tomorrow' },
    { id: 'this_week',   label: 'This Week' },
    { id: 'future',      label: 'Future' },
    { id: 'unconfirmed', label: 'Unconfirmed' },
    { id: 'in_progress', label: 'In Progress' },
];

export interface FilterableInspection {
    id?:     unknown;
    /** Either a JS Date, an ISO timestamp string, or `YYYY-MM-DD`. */
    date?:   string | Date | null;
    /** Free-form status; only `scheduled`, `draft`, `in_progress` are matched. */
    status?: string;
}

/** Returns the start of the local day for the given date (00:00:00.000). */
function startOfDay(d: Date): Date {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

/** Adds `days` to the given date and returns the new instance. */
function addDays(d: Date, days: number): Date {
    const x = new Date(d);
    x.setDate(x.getDate() + days);
    return x;
}

/** Returns the start of the calendar week (Sunday 00:00) containing `d`. */
function startOfWeek(d: Date): Date {
    const x = startOfDay(d);
    x.setDate(x.getDate() - x.getDay());
    return x;
}

/** Parses an inspection date into a JS Date, or returns null if missing. */
function parseInspectionDate(raw: string | Date | null | undefined): Date | null {
    if (!raw) return null;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
    const d = new Date(raw);
    return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Returns true when the given inspection matches the given time-filter,
 * relative to `now` (defaults to `new Date()`).
 */
export function matchesInspectionFilter(
    insp: FilterableInspection,
    filter: InspectionFilter,
    now: Date = new Date(),
): boolean {
    if (filter === 'all') return true;

    if (filter === 'unconfirmed') {
        const s = (insp.status || '').toLowerCase();
        // Spectora maps "unconfirmed" → not yet started, no in-person agreement.
        // Internally we map this to `scheduled` (calendar booked) and `draft`
        // (manually created, not yet started). Cancelled inspections never
        // match.
        return s === 'scheduled' || s === 'draft';
    }

    if (filter === 'in_progress') {
        return (insp.status || '').toLowerCase() === 'in_progress';
    }

    const date = parseInspectionDate(insp.date ?? null);
    if (!date) return false;

    const today        = startOfDay(now);
    const yesterday    = addDays(today, -1);
    const tomorrow     = addDays(today, 1);
    const weekStart    = startOfWeek(today);
    const weekEnd      = addDays(weekStart, 7); // exclusive
    const dayStart     = startOfDay(date);

    switch (filter) {
        case 'past':
            return dayStart.getTime() < today.getTime();
        case 'yesterday':
            return dayStart.getTime() === yesterday.getTime();
        case 'today':
            return dayStart.getTime() === today.getTime();
        case 'tomorrow':
            return dayStart.getTime() === tomorrow.getTime();
        case 'this_week':
            return dayStart.getTime() >= weekStart.getTime() && dayStart.getTime() < weekEnd.getTime();
        case 'future':
            return dayStart.getTime() >= weekEnd.getTime();
    }
    return false;
}

/**
 * Counts inspections matching each filter, returning an object keyed by
 * filter id. Used by the tab strip to render "TODAY (3)" style chips.
 *
 * The `all` count is always the total length of `inspections` (deduplicating
 * is the caller's responsibility — buckets in the dashboard already share ids
 * across needsAttention/today/etc., so callers should pass a deduped union).
 */
export function countByFilter(
    inspections: FilterableInspection[],
    now: Date = new Date(),
): Record<InspectionFilter, number> {
    const out: Record<InspectionFilter, number> = {
        all: 0, past: 0, yesterday: 0, today: 0, tomorrow: 0,
        this_week: 0, future: 0, unconfirmed: 0, in_progress: 0,
    };
    for (const i of inspections) {
        out.all++;
        for (const f of INSPECTION_FILTERS) {
            if (f.id === 'all') continue;
            if (matchesInspectionFilter(i, f.id, now)) out[f.id]++;
        }
    }
    return out;
}
