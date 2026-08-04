import { formatTime } from './format';
import {
    DEFAULT_DISPLAY_PREFS,
    type DateFormat,
    type TimeFormat,
} from '../../server/lib/session/display-prefs';

/**
 * The three axes this formatter needs, all supplied by the caller.
 *
 * `locale` is REQUIRED, for exactly the reason `timeZone` is (see below). It
 * used to be pinned to 'en-US' inside this file, with a comment promising that
 * "Phase A threads the viewer's effective locale through" — which never
 * happened, so a tenant on `es-419` read `Aug 3 · 7:58 AM EDT`: English month,
 * English meridiem, on a Spanish page. Nothing at the call sites showed it,
 * because the pin was three files away from anything a reviewer was looking at.
 * Naming the locale is now a compile-time obligation; get one from
 * `useDisplayLocale()` or, on a public surface, the tenant brand.
 *
 * `dateFormat` / `timeFormat` are the SHAPE (#270), deliberately independent of
 * the locale: the locale decides what language "September" is written in, the
 * enum decides whether the day comes before it and whether 14:30 is spelled
 * 2:30 PM. Both default to today's rendering, so an un-migrated caller is
 * byte-identical to before.
 */
export interface InspectionDateTimeFormat {
    /** BCP-47 tag. Blank falls back to 'en-US' rather than the browser's. */
    locale: string;
    dateFormat?: DateFormat;
    timeFormat?: TimeFormat;
}

/** Numeric date parts read in the target timezone, as strings. */
function numericParts(d: Date, timeZone: string): { year: string; month: string; day: string } {
    // 'en-CA' is used only as a stable NUMERIC source here — never for wording.
    const parts = new Intl.DateTimeFormat('en-CA', {
        year: 'numeric', month: '2-digit', day: '2-digit', timeZone,
    }).formatToParts(d);
    const pick = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? '';
    return { year: pick('year'), month: pick('month'), day: pick('day') };
}

/**
 * Assemble the date in the ORDER the enum names, using the LOCALE's words.
 *
 * This is assembled part-by-part rather than handed to `Intl` as an option bag
 * because an option bag cannot express the requirement: Intl derives the order
 * from the locale, so `es-419` with `{month:'short',day:'numeric'}` yields
 * `11 sept`, not the American order the tenant asked for. Order comes from the
 * enum; only the month WORD is localized.
 */
function formatDatePart(
    d: Date,
    timeZone: string,
    locale: string,
    dateFormat: DateFormat,
    showYear: boolean,
): string {
    const { year, month, day } = numericParts(d, timeZone);
    if (dateFormat === 'iso') {
        // ISO 8601 is not localized, and it always carries the year: `09-11` is
        // neither ISO nor unambiguous, so `showYear` does not apply here.
        return `${year}-${month}-${day}`;
    }
    const monthWord = new Intl.DateTimeFormat(locale, { month: 'short', timeZone }).format(d);
    const dayNum = String(Number(day));
    return dateFormat === 'eu'
        ? `${dayNum} ${monthWord}${showYear ? ` ${year}` : ''}`
        : `${monthWord} ${dayNum}${showYear ? `, ${year}` : ''}`;
}

/** C-14 part 1: humanize raw ISO timestamps on dashboard rows.
 *  `now` is injectable for deterministic tests; callers pass undefined.
 *
 *  This wrapper owns the dashboard-specific composition — drop the year in the
 *  current year, and join `date · time` with a short zone label. Language,
 *  zone and shape all arrive from the caller (see InspectionDateTimeFormat).
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
    fmt: InspectionDateTimeFormat,
): string {
    if (!iso) return 'no date';
    const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
    const d = new Date(dateOnly ? `${iso}T00:00:00Z` : iso);
    if (isNaN(d.getTime())) return 'no date';
    now = now ?? new Date();
    const tz = dateOnly ? 'UTC' : timeZone || 'UTC';
    const locale = fmt.locale || 'en-US';
    const dateFormat = fmt.dateFormat ?? DEFAULT_DISPLAY_PREFS.dateFormat;
    const timeFormat: TimeFormat = fmt.timeFormat ?? DEFAULT_DISPLAY_PREFS.timeFormat;

    const { year } = numericParts(d, tz);
    const showYear = Number(year) !== now.getUTCFullYear();
    const datePart = formatDatePart(d, tz, locale, dateFormat, showYear);
    if (dateOnly) return datePart;
    // Include the short zone name so a displayed time-of-day is unambiguous
    // (e.g. "9:00 AM EDT") — matters once tenants/users configure a timezone.
    const time = formatTime(iso, {
        locale,
        timeZone: tz,
        timeZoneName: 'short',
        hourCycle: timeFormat === '24h' ? 'h23' : 'h12',
    });
    return `${datePart} · ${time}`;
}
