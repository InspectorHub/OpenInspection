#!/usr/bin/env node
/**
 * Roadmap §7.5 item 3 — one-time backfill for `scheduled_start_ms` drift.
 *
 * Before the PATCH handler dual-wrote the scheduled instant, every calendar
 * drag (and settings-sheet date change) moved `inspections.date` while
 * `scheduled_start_ms` kept the OLD instant. This script finds rows whose
 * instant's civil date (in the TENANT timezone) no longer matches the row's
 * own `date`, and shifts start+end to the row's date preserving wall-clock
 * time-of-day — the same rule the handler now applies.
 *
 * DRY RUN by default: prints the planned updates and exits. Pass --apply to
 * write. Pass --remote to target remote D1 — read
 * docs/saas-ops/d1-migration-sop.md FIRST and take a `d1 export --remote`
 * backup + time-travel bookmark before applying remotely.
 *
 *   node scripts/backfill-scheduled-start.mjs                # local, dry run
 *   node scripts/backfill-scheduled-start.mjs --apply        # local, write
 *   node scripts/backfill-scheduled-start.mjs --remote       # remote, dry run
 *   node scripts/backfill-scheduled-start.mjs --remote --apply
 *
 * Timezone math duplicates server/lib/tz.ts (an .mjs script cannot import the
 * TS module). Both sides delegate DST to Intl; keep them behaviorally in sync.
 */
import { execSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const REMOTE = process.argv.includes('--remote');
const APPLY = process.argv.includes('--apply');

const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

// Windows-safe: a spawned arg list under shell:true loses its quoting, so the
// command line is assembled as one string with the SQL double-quoted.
// Backslash FIRST, then quote — escaping the quote first would re-escape the
// backslashes this step introduces. Without the backslash rule a value ending
// in `\` escapes the closing quote and the rest of the command line becomes
// argument data (CodeQL js/incomplete-sanitization).
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function d1(command, { json = true } = {}) {
  const cmd = [
    'npx', 'wrangler', 'd1', 'execute', 'DB',
    REMOTE ? '--remote' : '--local',
    '--command', q(command),
    '-c', cfg,
    ...(json ? ['--json'] : []),
  ].join(' ');
  const out = execSync(cmd, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (!json) return out;
  const parsed = JSON.parse(out);
  // wrangler --json returns [{ results: [...], success, meta }] per statement.
  return parsed.flatMap((s) => s.results ?? []);
}

// ── tz helpers (mirrors server/lib/tz.ts; Intl owns DST) ─────────────────────
function isValidTimeZone(tz) {
  if (!tz) return false;
  if (tz !== 'UTC' && !tz.includes('/')) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch { return false; }
}
const resolveTz = (raw) => (raw && isValidTimeZone(raw) ? raw : 'UTC');

function offsetMinutes(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - ms) / 60000);
}
const pad = (n) => String(n).padStart(2, '0');
function epochMsToWallClock(ms, tz) {
  const local = new Date(ms + offsetMinutes(ms, tz) * 60000);
  return {
    civil: `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`,
    hm: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
  };
}
function wallClockToEpochMs(dateYmd, timeHm, tz) {
  const [y, mo, d] = dateYmd.split('-').map(Number);
  const [h, mi] = timeHm.split(':').map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  return guess - offsetMinutes(guess, tz) * 60000;
}

// ── scan ─────────────────────────────────────────────────────────────────────
const rows = d1(
  'SELECT i.id, i.tenant_id, i.date, i.scheduled_start_ms, i.scheduled_end_ms, c.default_timezone ' +
  'FROM inspections i LEFT JOIN tenant_configs c ON c.tenant_id = i.tenant_id ' +
  'WHERE i.scheduled_start_ms IS NOT NULL',
);

const updates = [];
for (const r of rows) {
  const civilTarget = String(r.date ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(civilTarget)) continue; // unparseable date — leave it
  const tz = resolveTz(r.default_timezone);
  const startMs = Number(r.scheduled_start_ms);
  const wall = epochMsToWallClock(startMs, tz);
  if (wall.civil === civilTarget) continue; // instant agrees with the row's date
  const newStartMs = wallClockToEpochMs(civilTarget, wall.hm, tz);
  const delta = newStartMs - startMs;
  const endMs = r.scheduled_end_ms == null ? null : Number(r.scheduled_end_ms) + delta;
  updates.push({ id: String(r.id), tz, from: `${wall.civil} ${wall.hm}`, to: `${civilTarget} ${wall.hm}`, newStartMs, endMs });
}

console.log(`${rows.length} scheduled rows scanned, ${updates.length} diverged.`);
for (const u of updates) {
  console.log(`  ${u.id}: ${u.from} -> ${u.to} (${u.tz})`);
}

if (updates.length === 0) process.exit(0);
if (!APPLY) {
  console.log('\nDry run — nothing written. Re-run with --apply to write.' + (REMOTE ? ' (REMOTE: back up per docs/saas-ops/d1-migration-sop.md first.)' : ''));
  process.exit(0);
}

// Ids come from the SELECT above, not user input; still keep them quoted and
// batched well under D1's statement limits.
const BATCH = 40;
for (let i = 0; i < updates.length; i += BATCH) {
  const stmts = updates.slice(i, i + BATCH).map((u) =>
    `UPDATE inspections SET scheduled_start_ms = ${u.newStartMs}` +
    (u.endMs == null ? '' : `, scheduled_end_ms = ${u.endMs}`) +
    ` WHERE id = '${u.id.replace(/'/g, "''")}'`,
  );
  d1(stmts.join('; '), { json: false });
}
console.log(`Applied ${updates.length} update(s).`);
