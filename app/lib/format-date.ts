import { formatDate, formatTime } from './format';

/** C-14 part 1: humanize raw ISO timestamps on dashboard rows. en-US (US-market product).
 *  `now` is injectable for deterministic tests; callers pass undefined.
 *
 *  Date/time rendering delegates to the shared formatter (app/lib/format); this
 *  wrapper keeps the dashboard-specific composition — drop the year in the current
 *  year, and join `date · time` with a short zone label. locale is pinned to
 *  'en-US'; Phase A threads the viewer's effective locale through.
 *
 *  `timeZone` is REQUIRED, and that is the point. It used to be optional, and four
 *  of fourteen call sites left it off — two of them on the inspector portal, whose
 *  other calls passed it. An omitted zone falls through to Intl's default, which is
 *  the viewer's browser zone, so a single page rendered one instant in two zones: an
 *  inspection booked for 09:00 read 09:00 in the schedule card and 5:00 PM in the
 *  header for anyone eight hours off the tenant. The two calls were identical apart
 *  from a trailing argument, so review could not see it. Naming the zone is now a
 *  compile-time obligation; get one from `useDisplayTimeZone()` (viewer, then
 *  tenant) or the tenant brand's `defaultTimezone` on public surfaces. A blank
 *  value falls back to UTC rather than to whoever is looking. */
export function formatInspectionDateTime(
    iso: string | null | undefined,
    now: Date | undefined,
    timeZone: string,
): string {
    if (!iso) return 'no date';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
    if (isNaN(d.getTime())) return 'no date';
    now = now ?? new Date();
    const tz = dateOnly ? 'UTC' : timeZone || 'UTC';
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
