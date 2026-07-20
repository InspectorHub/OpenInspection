/**
 * IANA-timezone conversion helpers. Storage is always UTC epoch-ms (see the
 * Schema Rules timestamp policy); these convert at the display/output boundary.
 * DST is delegated entirely to the runtime's Intl database — never branch on
 * month/offset. IANA names only (never fixed offsets or abbreviations).
 *
 * WALL-CLOCK PREMISE: wallClockToEpochMs converts a *wall-clock* time to an
 * *instant*. This is the only DST-sensitive direction. Anchors that use it
 * (the 09:00 reminder anchor; calendar availability windows) must stay clear of
 * the DST transition windows — the spring-forward gap (02:00-03:00, a
 * nonexistent local time) and the fall-back overlap (01:00-02:00, ambiguous).
 * 09:00 and business hours are far from 02:00, so there is no ambiguity today.
 * If a future caller anchors near 02:00, define the nonexistent-time policy
 * here first (e.g. push forward to 03:00).
 */

/** True when `tz` is a resolvable IANA REGION timezone id (or 'UTC').
 *  Intl also accepts abbreviations and legacy fixed-offset zones ('EST', 'GMT',
 *  'PST8PDT'); we reject those so stored zones are always DST-aware region ids —
 *  a real region zone contains a '/' (e.g. 'America/New_York', 'Etc/GMT+5'). */
export function isValidTimeZone(tz: string): boolean {
  if (!tz) return false;
  if (tz !== 'UTC' && !tz.includes('/')) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The stored tenant tz if valid, else 'UTC' (fail-safe; existing-tenant default). */
export function resolveTenantTimeZone(raw: string | null | undefined): string {
  return raw && isValidTimeZone(raw) ? raw : 'UTC';
}

/** The signed numeric UTC offset (minutes) that `ianaTz` has at instant `ms`. */
function offsetMinutes(ms: number, ianaTz: string): number {
  // Format the instant as wall-clock parts in the target zone, treat those
  // parts as if they were UTC, and diff against the real instant.
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: ianaTz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - ms) / 60000);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** UTC epoch-ms -> RFC-3339 wall-clock string with the zone's offset. */
export function epochMsToRfc3339(ms: number, ianaTz: string): string {
  const off = offsetMinutes(ms, ianaTz);
  const local = new Date(ms + off * 60000); // shift so the UTC getters read local wall-clock
  const sign = off >= 0 ? '+' : '-';
  const abs = Math.abs(off);
  return (
    `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}` +
    `T${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** `YYYY-MM-DD` + `HH:MM` interpreted as local wall-clock in `ianaTz` -> UTC epoch ms. */
export function wallClockToEpochMs(dateYmd: string, timeHm: string, ianaTz: string): number {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, mi] = timeHm.split(':').map(Number);
  // Guess: treat the wall-clock as UTC, then correct by the offset at that guess.
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  const off = offsetMinutes(guess, ianaTz);
  return guess - off * 60000;
}
