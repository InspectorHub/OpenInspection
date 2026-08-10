/** IANA timezone ids for the settings pickers. Runtime built-in — no library.
 *  `supportedValuesOf` exists in the Workers/V8 runtime and modern browsers;
 *  the fallback keeps SSR safe if it is ever unavailable. */
export const TIMEZONE_OPTIONS: string[] = (() => {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] })
      .supportedValuesOf?.('timeZone');
    if (list && list.length) return list.includes('UTC') ? list : ['UTC', ...list];
  } catch {
    /* fall through */
  }
  return ['UTC', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles'];
})();

/** Current UTC offset for an IANA zone, in minutes (DST-aware at load time).
 *  Reads the runtime `longOffset` name (e.g. "GMT+08:00", "GMT-05:00", "GMT"). */
export function timeZoneOffsetMinutes(tz: string, at: Date = new Date()): number {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' })
      .formatToParts(at);
    const raw = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
    const m = /GMT([+-])(\d{2}):(\d{2})/.exec(raw);
    if (!m) return 0; // bare "GMT" → UTC
    return (m[1] === '-' ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3]));
  } catch {
    return 0;
  }
}

/** `UTC+08:00` / `UTC-05:00` — the offset prefix both pickers share. Exported so
 *  the public curated list can build `(UTC-06:00) Central Time` without picking
 *  the offset back out of a formatted label with string surgery. */
export function formatUtcOffset(min: number): string {
  return formatOffset(min);
}

function formatOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/** Mainstream-style picker label, e.g. `(UTC+08:00) Asia/Shanghai`. The stored
 *  value stays the raw IANA id; only the display text carries the offset.
 *
 *  `offsetMin` lets a caller that has ALREADY computed the offset pass it in.
 *  Resolving a zone costs an `Intl.DateTimeFormat` construction plus a
 *  `formatToParts`, and `TIMEZONE_SELECT_OPTIONS` below needs the offset twice
 *  (once to sort, once to label) for all 419 zones. Omitting it keeps the old
 *  one-argument behaviour for every other caller. */
export function timeZoneLabel(tz: string, offsetMin?: number): string {
  const off = offsetMin ?? timeZoneOffsetMinutes(tz);
  return `(${formatOffset(off)}) ${tz.replace(/_/g, ' ')}`;
}

/** The viewer's own IANA timezone as reported by the runtime, or null if it
 *  can't be resolved. CLIENT-ONLY in intent: on the server this returns the
 *  worker's zone (UTC), so callers must read it after mount (never during SSR)
 *  to avoid hydration mismatches. Used to offer "use my browser timezone" in
 *  the settings pickers — mirrors how mainstream field-service tools pre-detect
 *  the zone rather than defaulting silently to UTC. */
export function getBrowserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** Decide whether the onboarding "Set your timezone" step should pre-select the
 *  browser's zone. Returns the zone to adopt, or null to leave the picker alone.
 *  Only fires on the onboarding arrival (?setup=timezone), only when the tenant
 *  is still on the default UTC (never overrides a real choice), and only for a
 *  canonical zone the picker can actually represent (never a non-resolvable
 *  alias). Pure, so it is unit-testable in isolation. */
export function onboardingTzPrefill(opts: {
  isTimezoneSetup: boolean;
  storedTz: string | null;
  browserTz: string | null;
}): string | null {
  if (!opts.isTimezoneSetup) return null;
  const isUnset = !opts.storedTz || opts.storedTz === "UTC";
  if (!isUnset) return null;
  const b = opts.browserTz;
  if (!b || b === "UTC" || !TIMEZONE_OPTIONS.includes(b)) return null;
  return b;
}

/* NOTHING EXPENSIVE MAY BE ADDED AT MODULE SCOPE BELOW THIS LINE.
 *
 * This module is imported by `viewer-timezone.tsx`, which every public report
 * page pulls in. Everything above is a function declaration or a single cheap
 * `Intl.supportedValuesOf` call, so importing one helper costs nothing.
 *
 * The 419-entry `TIMEZONE_SELECT_OPTIONS` table used to live here, and because a
 * module's scope runs in full for any import of it, `getBrowserTimeZone` alone
 * was enough to build all 419 — during hydration, on pages that never showed a
 * picker. It now lives in `timezone-options.ts` (Settings) and
 * `timezone-options-public.ts` (curated, public), which are separate modules so
 * that neither drags the other. `timezone-module-boundaries.test.ts` fails if
 * that boundary is crossed again. */
