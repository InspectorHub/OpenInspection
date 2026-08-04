import { DATE_FORMATS, TIME_FORMATS } from "../../server/lib/session/display-prefs";
import { formatShapedDate } from "./format-date";
import { formatTime } from "./format";

/**
 * #270 — the option lists for the date/time format pickers.
 *
 * Every option's label IS a worked example rather than the enum's name. "ISO"
 * or "EU" tells the reader nothing they can check; `2026-09-11` and
 * `11 Sep 2026` tell them exactly what their reports will say. An enum label
 * alone is why somebody changes this setting twice.
 *
 * The sample instant is FIXED, not `Date.now()`. A live clock renders one value
 * on the server and another in the browser a moment later, which React reports
 * as a hydration mismatch — and the reader learns nothing from the current
 * minute that they do not learn from 2:30 PM. It is deliberately a two-digit
 * day in a month whose short name differs between languages, so a mis-wired
 * locale or a mis-wired order is visible in the label itself.
 */
const SAMPLE_ISO = "2026-09-11T14:30:00.000Z";
const SAMPLE_ZONE = "UTC";

/** Date-order options, worded in `locale` (the viewer's effective language). */
export function dateFormatOptions(locale: string): { value: string; label: string }[] {
  return DATE_FORMATS.map((value) => ({
    value,
    label: formatShapedDate(SAMPLE_ISO, SAMPLE_ZONE, { locale, dateFormat: value }),
  }));
}

/** Clock options. `hourCycle` is the whole difference; the locale supplies the
 *  meridiem's wording (and whether there is one). */
export function timeFormatOptions(locale: string): { value: string; label: string }[] {
  return TIME_FORMATS.map((value) => ({
    value,
    label: formatTime(SAMPLE_ISO, {
      locale,
      timeZone: SAMPLE_ZONE,
      hourCycle: value === "24h" ? "h23" : "h12",
    }),
  }));
}
