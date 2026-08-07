#!/usr/bin/env node
/**
 * Timezone-safety gate for the calendar surface (see
 * [redacted]).
 *
 * A civil calendar day mixed with UTC conversion shifts a day in UTC-positive
 * zones — the calendar off-by-one bug. The correct path is server-side tz
 * bucketing (calendar-items.service emits civilDate/startTime via server/lib/tz)
 * and string-keyed cells (civilDateOf), never Date/UTC math in the views.
 *
 * SCOPED to the calendar surface on purpose: every real bug lives here, while
 * legitimate `.toISOString().slice(0,10)` uses (server UTC-today, report year,
 * QBO document-creation dates) live elsewhere. QBO *money-movement* TxnDate is
 * NOT on that list any more — neither the payment nor the credit memo: both
 * book an accounting period, so both derive from the ledger row's occurred_at
 * in the tenant zone via epochMsToWallClockYmd (see txnDateFor in
 * server/services/qbo/invoice-sync.ts, which is the one date path they share).
 * A line opts out with a trailing — or immediately preceding —
 * `// tz-lint-ok: <reason>` comment.
 *
 * Flags:
 *   P1  hardcoded-Z instant composed from a civil date + wall-clock time
 *       (`${date}T09:00:00.000Z`) — anchor with wallClockToEpochMs(…, tz) instead.
 *   P2  `.toISOString().slice(0, 10)` — UTC-day bucketing; bucket by civilDate.
 *   P3  `new Date(<single arg>).get(Hours|Minutes|Date|Day)` — reads local parts
 *       off a parsed instant. (Multi-arg `new Date(y, m, d)` geometry is exempt.)
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const P1 = /\$\{[^}]*\}T\d{2}:\d{2}(:\d{2})?(\.\d{3})?Z/;
const P1_LITERAL = /[`'"]\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d{3})?Z/;
const P2 = /\.toISOString\(\)\.slice\(0,\s*10\)/;
// Single-arg only: `[^,)]+` forbids the comma of a multi-arg numeric constructor,
// so `new Date(year, month, 1).getDay()` (local grid geometry) is NOT flagged.
const P3 = /new Date\([^,)]+\)\.get(Hours|Minutes|Date|Day)\b/;

/** @returns {string[]} human-readable violation messages */
export function findTzViolations(source, filename) {
  const out = [];
  const lines = source.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/tz-lint-ok:/.test(line) || /tz-lint-ok:/.test(lines[i - 1] ?? '')) continue;
    if (P1.test(line) || P1_LITERAL.test(line)) {
      out.push(`${filename}:${i + 1} composes a UTC instant from a civil date + wall time (hardcoded Z); use wallClockToEpochMs(date, time, tz)`);
      continue;
    }
    if (P2.test(line)) {
      out.push(`${filename}:${i + 1} buckets by .toISOString().slice(0,10) (UTC day); bucket by the server civilDate string`);
      continue;
    }
    if (P3.test(line)) {
      out.push(`${filename}:${i + 1} reads local parts off a parsed instant (new Date(x).getHours/…); use the effective-tz startTime/civilDate`);
    }
  }
  return out;
}

// Calendar surface only. Test/spec files are exempt (they construct fixtures).
const SCOPE = [
  'app/components/calendar',
  'app/components/dispatch',
  'app/routes/calendar.tsx',
  'app/routes/calendar-dispatch.tsx',
  'server/services/calendar-items.service.ts',
  // Booking rules are civil-time rules stated in the OFFICE's terms — a lead
  // time in hours and a wall-clock same-day cutoff — and the ISO-week bucket
  // that `least_loaded` counts is a calendar question too. A
  // `.toISOString().slice(0,10)` here shipped green before this line existed;
  // it was caught by a test, which is one gate later than it should have been.
  'server/lib/booking',
  // What a booking ANNOUNCES is calendar output: the inspector's calendar entry
  // and the customer's .ics invite. Both used to recompose the slot time as
  // `${date}T${time}:00Z` — a wall clock labelled UTC — so both landed hours off
  // in every tenant zone but UTC, and disagreed with the scheduled_start_ms the
  // office sees. Both now read the stamped instant. Scoped so they stay that way.
  'server/services/booking',
  // The inspector iCal feeds. toUtcStamp here composed `${day}T${time}:00Z` —
  // a wall clock labelled UTC — so an 08:00 appointment in America/New_York was
  // published to every subscriber as 08:00Z, four hours before it happens. The
  // file was not in this list while the comment above claimed every real bug
  // lives here; that is what let it survive.
  'server/services/ics.service.ts',
];

function collectFiles(path) {
  const out = [];
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return out;
  }
  if (stat.isFile()) {
    if (/\.(ts|tsx)$/.test(path) && !/\.(test|spec)\.(ts|tsx)$/.test(path)) out.push(path);
    return out;
  }
  for (const entry of readdirSync(path)) out.push(...collectFiles(join(path, entry)));
  return out;
}

// CLI
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const files = SCOPE.flatMap(collectFiles);
  let violations = [];
  for (const f of files) violations = violations.concat(findTzViolations(readFileSync(f, 'utf8'), f));
  if (violations.length) {
    console.error('tz-safety gate FAILED:\n' + violations.join('\n'));
    process.exit(1);
  }
  console.log(`tz-safety gate OK (${files.length} calendar files)`);
}
