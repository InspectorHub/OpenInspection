/** C-14 part 1: humanize raw ISO timestamps on dashboard rows. en-US (US-market product).
 *  `now`/`timeZone` are injectable for deterministic tests; callers omit them. */
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
    const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: tz });
    const year = d.toLocaleDateString('en-US', { year: 'numeric', timeZone: tz });
    const yearPart = Number(year) === now.getUTCFullYear() ? '' : `, ${year}`;
    if (dateOnly) return `${md}${yearPart}`;
    // Include the short zone name so a displayed time-of-day is unambiguous
    // (e.g. "9:00 AM EDT") — matters once tenants/users configure a timezone.
    const time = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: tz, timeZoneName: 'short' });
    return `${md}${yearPart} · ${time}`;
}
