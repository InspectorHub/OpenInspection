import { TIMEZONE_OPTIONS, timeZoneOffsetMinutes, timeZoneLabel } from './timezones';

/**
 * The COMPLETE zone list for the authenticated Settings pickers.
 *
 * ── Why this is not in `timezones.ts` ──
 * Importing any binding from a module evaluates all of it. While this table
 * lived beside the cheap helpers, `viewer-timezone.tsx` importing
 * `getBrowserTimeZone` was enough to build all 419 entries — on the server per
 * isolate, and in the browser during hydration of every public page that
 * rendered a date, including for visitors whose link was invalid and who never
 * saw a zone picker at all.
 *
 * Splitting it out is what lets a route pay for this only when it shows it.
 * `timezone-options-public.ts` is a THIRD module for the same reason: putting
 * the curated public list in this file would drag all 419 zones back onto the
 * public pages and quietly undo the split. `timezone-module-boundaries.test.ts`
 * holds that line.
 *
 * ── The offset is threaded, not recomputed ──
 * It used to be destructured away after the sort and resolved a second time
 * inside `timeZoneLabel`: 838 `Intl.DateTimeFormat` constructions for 419 zones.
 * Measured at a 6x CPU throttle, cold, this table costs ~450ms to build as it
 * stands. See tests/e2e/public-timezone-hydration-cost.spec.ts (#99).
 *
 * Sorted west→east by current UTC offset (then name), so the list reads like
 * mainstream pickers. `value` is the IANA id (persisted); `label` shows the
 * offset.
 */
export const TIMEZONE_SELECT_OPTIONS: { value: string; label: string }[] =
  TIMEZONE_OPTIONS
    .map((tz) => ({ tz, offset: timeZoneOffsetMinutes(tz) }))
    .sort((a, b) => a.offset - b.offset || a.tz.localeCompare(b.tz))
    .map(({ tz, offset }) => ({ value: tz, label: timeZoneLabel(tz, offset) }));
