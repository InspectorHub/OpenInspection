#!/usr/bin/env node
/**
 * Migration-lag gate (`db:lag`): compare the migrations COMMITTED IN THE REPO
 * against the migrations a target D1 database has ACTUALLY APPLIED
 * (its `d1_migrations` table), and print both counts side by side.
 *
 * ## Why this exists
 *
 * `db:check` (`verify-migration-equivalence.mjs`) compares the Drizzle schema
 * against `migrations/`. Both of those live in the repo, so the whole check can
 * be green while production runs a database several migrations older than the
 * code about to be deployed onto it. Nothing — not CI, not pre-push, not the
 * release skills — ever asked the database what it had applied.
 *
 * That is not hypothetical. On 2026-08-09 the SaaS core database was found at
 * `0050` while the repo was at `0056`; it was discovered by accident, because a
 * read-only query returned `no such column: trade_slug`. Nothing had broken yet
 * only because the last deploy predated the migrations landing in git — old code
 * against an old schema is self-consistent. The NEXT deploy would have shipped
 * code that reads `trade_slug`, `repair_action_tag`, `ai_content_reviews` and
 * `inspector_narrative` against a database with none of them.
 *
 * ## Both numbers are printed together, on purpose
 *
 * The report prints `repo migrations` and `database applied` on adjacent lines
 * with their difference underneath. Two numbers that are supposed to be equal,
 * shown side by side, make the discrepancy impossible to miss — a gate that
 * prints only a verdict is a gate that can hide the comparison it claims to
 * make.
 *
 * ## Fail-closed
 *
 * An unreadable database (network error, expired auth, wrong account, timeout,
 * unparseable output) EXITS NON-ZERO. "I could not ask" must never render as
 * "there is no lag" — that reading is the exact failure this gate exists to
 * prevent.
 *
 * ## Database AHEAD of the repo
 *
 * Applied names the repo does not contain are also a failure: something was
 * applied out of band, or the branch being deployed is older than production.
 * The one legitimate case is a squashed/rebuilt migration chain, where the
 * pre-rebuild filenames stay recorded in `d1_migrations` forever. Those are
 * declared per-database in the baseline file (`--baseline`, default
 * `scripts/migration-lag-baseline.json`); anything not declared there fails.
 *
 * Usage:
 *   node scripts/check-migration-lag.mjs                       # resolved config, --remote
 *   node scripts/check-migration-lag.mjs --local               # local D1 (miniflare state)
 *   node scripts/check-migration-lag.mjs -c wrangler.saas.jsonc
 *   node scripts/check-migration-lag.mjs --env production      # named wrangler env (cms)
 *   node scripts/check-migration-lag.mjs --migrations-dir <dir>
 *   node scripts/check-migration-lag.mjs --label <name>        # baseline key + display name
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { basename, dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// Pure helpers, exported for tests/unit/tooling/migration-lag-gate.spec.ts.
// This is the CANONICAL copy. apps/portal and apps/cms carry logic-identical
// duplicates (separate submodules, no shared package) that differ only in their
// header prose and the "how to apply" hint — fix bugs in all three.
// ---------------------------------------------------------------------------

/** True when the error text says the migrations table itself is absent. */
export function isMissingMigrationsTable(text) {
  return /no such table:\s*(main\.)?d1_migrations/i.test(String(text ?? ''));
}

/**
 * Pull the FIRST balanced `[...]` out of wrangler's output that actually parses
 * as JSON.
 *
 * Naively slicing from `indexOf('[')` is wrong and was caught by this gate's own
 * positive-control test: wrangler's banner is `▲ [WARNING] Processing …`, so the
 * first `[` in the stream can belong to a log line, not the payload. Depending
 * on whether the banner lands on stdout or stderr, the same query then either
 * parses or blows up — a parser whose correctness depends on log routing.
 *
 * So: walk every `[`, extract a bracket-balanced (string-aware) span from it,
 * and return the first one that parses. Throws if none do.
 */
function extractJsonArray(text) {
  let found = false;
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '[') continue;
    found = true;
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let j = i; j < text.length; j++) {
      const ch = text[j];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === '\\') esc = true;
        else if (ch === '"') inStr = false;
        continue;
      }
      if (ch === '"') inStr = true;
      else if (ch === '[' || ch === '{') depth++;
      else if (ch === ']' || ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.slice(i, j + 1));
          } catch {
            break; // this `[` was not the payload; try the next one
          }
        }
      }
    }
  }
  throw new Error(
    found ? 'wrangler JSON payload did not parse' : 'wrangler produced no JSON payload',
  );
}

/**
 * Extract the applied migration names from `wrangler d1 execute --json` output.
 *
 * THROWS on anything it cannot positively read as a successful result set — a
 * silent `[]` here would be indistinguishable from a database with nothing
 * applied, which is the one answer this gate must never guess at.
 */
export function parseAppliedNames(stdout) {
  const text = String(stdout ?? '');
  const payload = extractJsonArray(text);
  if (!Array.isArray(payload) || payload.length === 0) {
    throw new Error('wrangler JSON payload was not a non-empty array of results');
  }
  const first = payload[0];
  if (!first || typeof first !== 'object') throw new Error('wrangler result 0 was not an object');
  if (first.success !== true) throw new Error('wrangler reported the query did not succeed');
  if (!Array.isArray(first.results)) throw new Error('wrangler result 0 carried no `results` array');

  return first.results.map((row) => {
    if (!row || typeof row.name !== 'string') {
      throw new Error('a d1_migrations row carried no `name` column');
    }
    return row.name;
  });
}

/**
 * Compare the two sets. `acceptedExtra` is the audited allowlist of applied
 * names that legitimately no longer exist in the repo (squashed chain).
 */
export function diffMigrations({ repoFiles, applied, acceptedExtra = [] }) {
  const appliedSet = new Set(applied);
  const repoSet = new Set(repoFiles);
  const acceptedSet = new Set(acceptedExtra);

  const missing = repoFiles.filter((f) => !appliedSet.has(f)).sort();
  const allExtra = applied.filter((f) => !repoSet.has(f)).sort();
  return {
    missing,
    extra: allExtra.filter((f) => !acceptedSet.has(f)),
    acceptedExtra: allExtra.filter((f) => acceptedSet.has(f)),
    // An allowlist entry that no longer appears in the database is stale.
    staleAccepted: [...acceptedSet].filter((f) => !appliedSet.has(f)).sort(),
  };
}

/** The side-by-side report. Both counts always print, in sync AND out of sync. */
export function renderReport({
  label,
  source,
  migrationsDir,
  repoCount,
  appliedCount,
  missing,
  extra,
  acceptedExtra = [],
  staleAccepted = [],
}) {
  // Pre-rebuild names are subtracted on their own line rather than quietly
  // ignored, so the two headline numbers still visibly reconcile to the
  // difference underneath them.
  const effectiveApplied = appliedCount - acceptedExtra.length;
  const delta = repoCount - effectiveApplied;
  const rows = [
    [`repo      ${migrationsDir}/*.sql`, repoCount],
    ['database  d1_migrations rows', appliedCount],
  ];
  if (acceptedExtra.length) {
    rows.push(['  less pre-rebuild names (baseline)', -acceptedExtra.length]);
  }
  const width = Math.max(...rows.map(([, n]) => String(n).length), String(delta).length, 3);
  const left = Math.max(...rows.map(([t]) => t.length), 'difference'.length) + 2;
  const row = (text, n) => '  ' + text.padEnd(left) + String(n).padStart(width);
  const lines = [
    '',
    `Migration lag — ${label}`,
    `  source: ${source}`,
    '',
    ...rows.map(([t, n]) => row(t, n)),
    '  ' + '─'.repeat(left + width),
    row('difference', delta),
    '',
  ];

  if (missing.length) {
    lines.push(`  ✘ ${missing.length} migration(s) in the repo the DATABASE HAS NOT APPLIED:`);
    for (const f of missing) lines.push(`      ${f}`);
    lines.push('');
  }
  if (extra.length) {
    lines.push(`  ✘ ${extra.length} migration(s) APPLIED OUT OF BAND (not in this repo):`);
    for (const f of extra) lines.push(`      ${f}`);
    lines.push('');
  }
  if (staleAccepted.length) {
    lines.push(`  ✘ ${staleAccepted.length} baseline entr(ies) no longer present in the database:`);
    for (const f of staleAccepted) lines.push(`      ${f}`);
    lines.push('    Remove them from the baseline — a stale allowlist hides real drift.');
    lines.push('');
  }

  if (!missing.length && !extra.length && !staleAccepted.length) {
    const note = acceptedExtra.length
      ? ` (${acceptedExtra.length} pre-rebuild name${acceptedExtra.length === 1 ? '' : 's'} accepted by the baseline)`
      : '';
    lines.push(
      `  ✅ in sync — every one of the ${repoCount} committed migration(s) is applied${note}.`,
    );
    lines.push('');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = { binding: 'DB', migrationsDir: 'migrations', local: false, timeoutMs: 120_000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--local') out.local = true;
    else if (a === '-c' || a === '--config') out.config = argv[++i];
    else if (a === '--env') out.env = argv[++i];
    else if (a === '--binding') out.binding = argv[++i];
    else if (a === '--migrations-dir') out.migrationsDir = argv[++i];
    else if (a === '--label') out.label = argv[++i];
    else if (a === '--baseline') out.baseline = argv[++i];
    else if (a === '--timeout') out.timeoutMs = Number(argv[++i]);
    else throw new Error(`unknown argument: ${a}`);
  }
  return out;
}

/** Mirrors scripts/wrangler.mjs so this gate targets what db:migrate targets. */
function resolveConfig(explicit) {
  if (explicit) return explicit;
  if (process.env.WRANGLER_CONFIG) return process.env.WRANGLER_CONFIG;
  if (existsSync(join(ROOT, 'wrangler.local.jsonc'))) return 'wrangler.local.jsonc';
  if (existsSync(join(ROOT, 'wrangler.jsonc'))) return 'wrangler.jsonc';
  return null; // wrangler.toml / default discovery
}

function loadBaseline(path, label) {
  if (!path || !existsSync(path)) return [];
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const entry = raw[label];
  if (!entry) return [];
  if (!Array.isArray(entry.acceptedExtra)) {
    throw new Error(`baseline entry "${label}" has no acceptedExtra array`);
  }
  return entry.acceptedExtra;
}

function die(msg) {
  console.error(`\n✘ migration-lag gate: ${msg}`);
  console.error('  Refusing to report "no lag" for a database this gate could not read.\n');
  process.exit(1);
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    die(e.message);
    return;
  }

  const migDir = resolve(ROOT, opts.migrationsDir);
  if (!existsSync(migDir)) die(`migrations directory not found: ${migDir}`);
  const repoFiles = readdirSync(migDir).filter((f) => f.endsWith('.sql')).sort();

  const config = resolveConfig(opts.config);
  const args = ['wrangler', 'd1', 'execute', opts.binding];
  if (config) args.push('-c', config);
  if (opts.env) args.push('--env', opts.env);
  args.push(opts.local ? '--local' : '--remote', '--json', '--command');
  args.push('"SELECT name FROM d1_migrations ORDER BY name"');

  const where = opts.local ? 'local' : 'remote';
  const label = opts.label ?? `${opts.binding} (${config ?? 'wrangler.toml'}${opts.env ? `, env=${opts.env}` : ''}, ${where})`;
  const baselinePath = opts.baseline ?? join(ROOT, 'scripts', 'migration-lag-baseline.json');

  const r = spawnSync('npx', args, {
    cwd: ROOT,
    encoding: 'utf8',
    shell: true,
    timeout: opts.timeoutMs,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stderr = r.stderr ?? '';
  let applied;
  if (r.error && r.error.code === 'ETIMEDOUT') {
    die(`wrangler timed out after ${opts.timeoutMs}ms querying ${label}.`);
  } else if (r.error) {
    die(`could not run wrangler: ${r.error.message}`);
  } else if (isMissingMigrationsTable(stderr) || isMissingMigrationsTable(r.stdout)) {
    // A database with no d1_migrations table has applied nothing. Reported as
    // zero (loudly) rather than as an error, so the numbers still print — but
    // any repo with migrations still fails below.
    console.error(`\n⚠ ${label}: no d1_migrations table — treating the applied set as EMPTY.`);
    applied = [];
  } else if (r.status !== 0) {
    die(`wrangler exited ${r.status} reading ${label}:\n${`${stderr}\n${r.stdout ?? ''}`.trim()}`);
  } else {
    try {
      applied = parseAppliedNames(r.stdout);
    } catch (e) {
      die(`could not read the applied set from ${label}: ${e.message}`);
    }
  }

  let acceptedExtra;
  try {
    acceptedExtra = loadBaseline(baselinePath, opts.label ?? label);
  } catch (e) {
    die(`baseline ${baselinePath}: ${e.message}`);
    return;
  }

  const d = diffMigrations({ repoFiles, applied, acceptedExtra });
  console.log(
    renderReport({
      label,
      source: `${config ?? 'wrangler.toml'} → ${opts.binding} (${where})  ·  repo dir: ${migDir}`,
      migrationsDir: basename(migDir),
      repoCount: repoFiles.length,
      appliedCount: applied.length,
      ...d,
    }),
  );

  if (d.missing.length) {
    console.error(
      '  Apply them before deploying:  npm run db:migrate:remote  (or db:migrate:saas:remote)\n',
    );
  }
  if (d.extra.length) {
    console.error(
      '  The database is AHEAD of this checkout. Three things cause that:\n' +
        '    1. someone applied SQL out of band;\n' +
        '    2. this branch predates production;\n' +
        '    3. a release REBUILT the baseline — then these are the names of the forward\n' +
        '       files it folded into 0000_baseline.sql, nothing was applied out of band,\n' +
        '       and the database is right to still remember them.\n' +
        '  For (3), follow "Upgrading across a rebuilt baseline" in\n' +
        '  docs/operate/upgrade.md: it brings the schema current and then rewrites the\n' +
        '  ledger, which is what clears this message. Do NOT declare these names in the\n' +
        '  baseline file instead — that silences the report while the schema stays behind.\n',
    );
  }
  process.exit(d.missing.length || d.extra.length || d.staleAccepted.length ? 1 : 0);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
