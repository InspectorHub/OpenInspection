/**
 * `inspections.date` as a PERSON reads it — the one place that column is turned
 * into prose, for every channel that puts it in front of somebody.
 *
 * -- WHY THIS IS NEEDED ------------------------------------------------------
 * `inspections.date` is calendar TEXT, and it carries two shapes (measured
 * across every writer of the column; the catalogue is in
 * `server/lib/statutory/inspection-date.ts`): a bare `YYYY-MM-DD`, and that
 * followed by a wall-clock time. The booking path writes the second one as
 * `${date}T${HH:MM}:00Z` — where the `Z` is a BUSY-CHECK KEY, not an instant
 * (`fulfill-booking.ts` says so at the line that writes it, and
 * `reschedule-date.ts` reads the clock straight back out at `slice(11, 16)`).
 * Interpolated raw into a message, that reaches a reader as
 * "A new booking came in for 2026-09-16T08:00:00Z."
 *
 * -- WHOSE LOCALE AND ZONE ---------------------------------------------------
 * The TENANT's, never the reader's and never the server's. That is not a
 * shortcut around per-recipient resolution — it is the rule stated at
 * `resolveDisplayPrefs` in `server/lib/session/display-prefs.ts`: anything a
 * SECOND PARTY also sees (inspection dates, report dates, appointment times) is
 * resolved from the tenant alone, because the inspector, the client and the
 * agent discuss one inspection by phone and a per-viewer rendering turns that
 * into a support call. The pair is read exactly the way the report-delivery
 * email path reads it for `event_scheduled_at` (`deliver-email.ts`):
 * `resolveLocale(defaultLocale)` + `resolveTenantTimeZone(defaultTimezone)`.
 *
 * -- WHY THE ZONE IS APPLIED TO THE CLOCK AND NOT TO THE DAY ------------------
 * A civil day names no instant. Anchoring one in a zone and formatting it back
 * is how the calendar off-by-one is born, so the day branch below formats the
 * UTC-midnight anchor in UTC and never touches the tenant zone. The clock
 * branch does the opposite and must: the stored wall clock IS tenant-local, so
 * it is anchored with `wallClockToEpochMs` and rendered back in the same zone —
 * a round trip that returns the same wall clock, and whose only visible effect
 * is the short zone name, which is what stops a bare "8:00 AM" from being a
 * silent claim about UTC.
 */
import { eq } from 'drizzle-orm';
import { tenantConfigs } from '../db/schema';
import { formatDate, formatDateTime } from '../format';
import { resolveLocale } from '../locale';
import { resolveTenantTimeZone, wallClockToEpochMs } from '../tz';

/** The two stored shapes, with the seconds/offset tail the column sometimes
 *  carries discarded — no human-facing sentence is answered by seconds. */
const STORED = /^(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}:\d{2}))?/;

/** The workspace's display pair. Build it with `readTenantDisplay`. */
export interface ScheduledDateDisplay {
    /** BCP-47 tag, already through `resolveLocale`. */
    locale: string;
    /** IANA zone, already through `resolveTenantTimeZone`. */
    timeZone: string;
}

// The two drivers (async D1, synchronous better-sqlite3) share this builder
// surface; every automation path already types its db handles this way.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * Resolve `(locale, timeZone)` for `tenantId` — the read four senders used to
 * each have to remember to make (in-app notices, templated email, report email,
 * the manual report send).
 *
 * FAIL-SOFT by construction. A missing row, an unreadable column and a broken
 * read all land on the same answer the resolvers give for a null: `'en-US'` and
 * the UTC sentinel. Both are documented defaults, and neither is a reason to
 * withhold a notification — the posture `createRecipientLocaleResolver` already
 * takes for language.
 *
 * The caller holds the result for the life of one firing, one flush batch or
 * one request: a rule fanning out to eight recipients must not read the same
 * row eight times, for the same reason the locale resolver memoizes.
 */
export async function readTenantDisplay(db: AnyDb, tenantId: string): Promise<ScheduledDateDisplay> {
    let row: { defaultLocale?: string | null; defaultTimezone?: string | null } | undefined;
    try {
        row = await db.select({
            defaultLocale: tenantConfigs.defaultLocale,
            defaultTimezone: tenantConfigs.defaultTimezone,
        }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    } catch {
        // Leave undefined: the resolvers below answer for a null exactly as
        // they answer for a workspace that never opened Settings.
    }
    return {
        locale: resolveLocale(row?.defaultLocale),
        timeZone: resolveTenantTimeZone(row?.defaultTimezone),
    };
}

/**
 * Render a stored `inspections.date` for a reader.
 *
 * NEVER THROWS and never returns a partial-looking placeholder: an unreadable
 * or absent value yields `''`, which is what `interpolate` already renders for
 * a missing token. A notice must not fail to exist because a date is odd, and
 * a message that says "Invalid Date" is worse than one that says nothing.
 */
export function formatScheduledDate(
    stored: string | null | undefined,
    display: ScheduledDateDisplay,
): string {
    if (!stored) return '';
    const parts = STORED.exec(stored);
    if (!parts) return '';
    const [, civilDay, wallClock] = parts;
    if (!wallClock) {
        // `formatDate` anchors a bare YYYY-MM-DD at UTC midnight; formatting it
        // back in UTC is the only pairing that returns the same calendar day.
        return formatDate(civilDay, { locale: display.locale, timeZone: 'UTC' });
    }
    const at = new Date(wallClockToEpochMs(civilDay, wallClock, display.timeZone));
    if (Number.isNaN(at.getTime())) return '';
    return formatDateTime(at, display);
}
