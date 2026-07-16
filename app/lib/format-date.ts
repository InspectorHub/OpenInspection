import { formatDate, formatTime } from './format';

/** C-14 part 1: humanize raw ISO timestamps on dashboard rows. en-US (US-market product).
 *  `now`/`timeZone` are injectable for deterministic tests; callers omit them.
 *
 *  Date/time rendering delegates to the shared formatter (app/lib/format); this
 *  wrapper keeps the dashboard-specific composition — drop the year in the current
 *  year, and join `date · time` with a short zone label. locale is pinned to
 *  'en-US'; Phase A threads the viewer's effective locale through. */
export function formatInspectionDateTime(
    iso: string | null | undefined,
    now: Date = new Date(),
    timeZone?: string,
): string {
    if (!iso) return 'no date';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
    if (isNaN(d.getTime())) return 'no date';
    const tz = dateOnly ? 'UTC' : timeZone;
    // en-US formatDate always ends in `, YYYY`; strip it when the year matches now.
    const full = formatDate(iso, { locale: 'en-US', timeZone: tz, month: 'short' });
    const yearMatch = full.match(/,\s*(\d{4})$/);
    const year = yearMatch ? Number(yearMatch[1]) : NaN;
    const datePart = year === now.getUTCFullYear() ? full.replace(/,\s*\d{4}$/, '') : full;
    if (dateOnly) return datePart;
    // Include the short zone name so a displayed time-of-day is unambiguous
    // (e.g. "9:00 AM EDT") — matters once tenants/users configure a timezone.
    const time = formatTime(iso, { locale: 'en-US', timeZone: tz, timeZoneName: 'short' });
    return `${datePart} · ${time}`;
}
