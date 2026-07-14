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

function formatOffset(min: number): string {
  const sign = min < 0 ? '-' : '+';
  const abs = Math.abs(min);
  const hh = String(Math.floor(abs / 60)).padStart(2, '0');
  const mm = String(abs % 60).padStart(2, '0');
  return `UTC${sign}${hh}:${mm}`;
}

/** Mainstream-style picker label, e.g. `(UTC+08:00) Asia/Shanghai`. The stored
 *  value stays the raw IANA id; only the display text carries the offset. */
export function timeZoneLabel(tz: string): string {
  return `(${formatOffset(timeZoneOffsetMinutes(tz))}) ${tz.replace(/_/g, ' ')}`;
}

/** `{ value, label }` options for the settings `<Select>`, sorted west→east by
 *  current UTC offset (then name) so the list reads like mainstream tz pickers.
 *  `value` is the IANA id (persisted); `label` shows the offset. */
export const TIMEZONE_SELECT_OPTIONS: { value: string; label: string }[] =
  TIMEZONE_OPTIONS
    .map((tz) => ({ tz, offset: timeZoneOffsetMinutes(tz) }))
    .sort((a, b) => a.offset - b.offset || a.tz.localeCompare(b.tz))
    .map(({ tz }) => ({ value: tz, label: timeZoneLabel(tz) }));
