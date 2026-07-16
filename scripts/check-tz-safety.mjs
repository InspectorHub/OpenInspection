#!/usr/bin/env node
/**
 * Timezone-safety gate for the calendar surface (see
 * docs/superpowers/plans/2026-07-16-oi-calendar-tz-offbyone-apolish-backlog.md).
 *
 * A civil calendar day mixed with UTC conversion shifts a day in UTC-positive
 * zones — the calendar off-by-one bug. The correct path is server-side tz
 * bucketing (calendar-items.service emits civilDate/startTime via server/lib/tz)
 * and string-keyed cells (civilDateOf), never Date/UTC math in the views.
 *
 * SCOPED to the calendar surface on purpose: every real bug lives here, while
 * legitimate `.toISOString().slice(0,10)` uses (server UTC-today, QBO TxnDate,
 * report year) live elsewhere. A line opts out with a trailing — or immediately
 * preceding — `// tz-lint-ok: <reason>` comment.
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
  'app/routes/calendar.tsx',
  'server/services/calendar-items.service.ts',
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
