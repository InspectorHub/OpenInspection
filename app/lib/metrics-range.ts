/**
 * The date range behind /metrics — presets, arithmetic, and URL round-tripping.
 *
 * Why this replaced a `period=3m|6m|12m` enum: "3m" is the system's vocabulary,
 * not a reader's. Someone asking "how did last week go?" had no way to express
 * it, and someone reading "6m" had to work out which six months. A range says
 * what it covers, and the presets name the questions people actually ask.
 *
 * **Everything here is civil-date string arithmetic.** A metrics window is a
 * span of calendar days, not of instants: `inspections.date` is a civil date,
 * and "the last 7 days" means seven days on the viewer's wall calendar. Dates
 * are parsed into UTC-noon instants purely as a way to do day arithmetic that
 * cannot be dragged across a boundary by a DST shift, then formatted straight
 * back to `YYYY-MM-DD`. No local-time reads, no zone conversion.
 */

export interface MetricsRange {
  /** Inclusive first day, `YYYY-MM-DD`. */
  from: string;
  /** Inclusive last day, `YYYY-MM-DD`. */
  to: string;
}

export type PresetId = "7d" | "14d" | "30d" | "3m" | "6m" | "12m" | "ytd";

/** Ordered as they appear in the picker: days, then months, then YTD. */
export const PRESET_IDS: readonly PresetId[] = ["7d", "14d", "30d", "3m", "6m", "12m", "ytd"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Longest window a single request may ask for — five years of calendar days. */
const MAX_SPAN_DAYS = 366 * 5;

function toUtcNoon(date: string): number | null {
  if (!DATE_RE.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d, 12);
  // Reject impossible civil dates (2026-02-31 rolls over to March in Date.UTC).
  return format(ms) === date ? ms : null;
}

function format(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

function addDays(date: string, days: number): string {
  const ms = toUtcNoon(date);
  return ms === null ? date : format(ms + days * 86_400_000);
}

function addMonths(date: string, months: number): string {
  const ms = toUtcNoon(date);
  if (ms === null) return date;
  const d = new Date(ms);
  const targetMonth = d.getUTCMonth() + months;
  const shifted = new Date(Date.UTC(d.getUTCFullYear(), targetMonth, d.getUTCDate(), 12));
  // Clamp a day that the target month does not have: three months back from
  // May 31 is Feb 31, which Date.UTC rolls into March. Land on the last day of
  // the intended month instead, so the window keeps its stated length.
  if (shifted.getUTCMonth() !== ((targetMonth % 12) + 12) % 12) {
    return format(Date.UTC(d.getUTCFullYear(), targetMonth + 1, 0, 12));
  }
  return format(shifted.getTime());
}

/**
 * The civil date it is *right now* in a zone. `new Date()` alone answers for
 * the machine, which in a UTC+N deployment is already tomorrow for part of the
 * evening — that is the calendar off-by-one this codebase has fixed once
 * already (see `lint:tz`).
 */
export function civilToday(timeZone: string, now: Date = new Date()): string {
  try {
    // i18n-lint-ok: machine-readable parts, never displayed
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || "UTC",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    const date = `${get("year")}-${get("month")}-${get("day")}`;
    return DATE_RE.test(date) ? date : format(now.getTime());
  } catch {
    // Unknown zone — fall back to the UTC calendar rather than throwing.
    return format(now.getTime());
  }
}

/**
 * Resolve a preset against a given "today". `to` is always today: every preset
 * here names a trailing window, and a metrics page that quietly excluded today
 * would be wrong on the day someone most wants to look at it.
 */
export function presetRange(id: PresetId, today: string): MetricsRange {
  switch (id) {
    case "7d":  return { from: addDays(today, -6),   to: today };
    case "14d": return { from: addDays(today, -13),  to: today };
    case "30d": return { from: addDays(today, -29),  to: today };
    case "3m":  return { from: addMonths(today, -3), to: today };
    case "6m":  return { from: addMonths(today, -6), to: today };
    case "12m": return { from: addMonths(today, -12), to: today };
    case "ytd": return { from: `${today.slice(0, 4)}-01-01`, to: today };
  }
}

/** The default window when the URL names none. */
const DEFAULT_PRESET: PresetId = "3m";

/**
 * Which preset, if any, a range currently equals. Used to light up the active
 * preset after a reload without keeping a second `preset=` parameter in the URL
 * — one representation of the window, and it is the one the server reads.
 */
export function matchPreset(range: MetricsRange, today: string): PresetId | null {
  for (const id of PRESET_IDS) {
    const p = presetRange(id, today);
    if (p.from === range.from && p.to === range.to) return id;
  }
  return null;
}

/**
 * Coerce whatever arrived in the URL into a usable window.
 *
 * Malformed, missing, or reversed input resolves rather than errors: a metrics
 * page that renders an error because someone hand-edited a query string is
 * worse than one that shows the default window. A range longer than
 * MAX_SPAN_DAYS is trimmed from the `from` end — the endpoint scans every
 * result envelope in the window, so an unbounded span is a denial-of-service
 * with extra steps.
 */
export function normaliseRange(
  fromParam: string | null,
  toParam: string | null,
  today: string,
): MetricsRange {
  const from = fromParam && toUtcNoon(fromParam) !== null ? fromParam : null;
  const to = toParam && toUtcNoon(toParam) !== null ? toParam : null;

  if (!from && !to) return presetRange(DEFAULT_PRESET, today);
  // One end supplied: treat the other as open and clamp it to today.
  const start = from ?? presetRange(DEFAULT_PRESET, today).from;
  const end = to ?? today;
  const [lo, hi] = start <= end ? [start, end] : [end, start];

  const spanDays = Math.round((toUtcNoon(hi)! - toUtcNoon(lo)!) / 86_400_000);
  return spanDays > MAX_SPAN_DAYS ? { from: addDays(hi, -MAX_SPAN_DAYS), to: hi } : { from: lo, to: hi };
}

/** `Apr 29 – Jul 29, 2026`, or `Apr 29, 2025 – Jul 29, 2026` when years differ. */
export function formatRange(range: MetricsRange, locale: string): string {
  const start = toUtcNoon(range.from);
  const end = toUtcNoon(range.to);
  if (start === null || end === null) return `${range.from} – ${range.to}`;
  const sameYear = range.from.slice(0, 4) === range.to.slice(0, 4);
  const opts: Intl.DateTimeFormatOptions = { timeZone: "UTC", month: "short", day: "numeric" };
  const startText = new Intl.DateTimeFormat(locale, sameYear ? opts : { ...opts, year: "numeric" }).format(start);
  const endText = new Intl.DateTimeFormat(locale, { ...opts, year: "numeric" }).format(end);
  return `${startText} – ${endText}`;
}
