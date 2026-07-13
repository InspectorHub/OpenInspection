#!/usr/bin/env node
/**
 * Epoch-ms range assertion for the timestamp-normalization migration (see
 * CLAUDE.md "Schema Rules" — all timestamps must be integer epoch-ms).
 * Samples MIN/MAX per column across a representative set of migrated tables
 * and fails if any non-null value falls outside a sane epoch-ms window
 * (~2015 .. ~2035), which would indicate a column still holding raw seconds
 * (or some other unit) instead of milliseconds.
 *
 * This is a representative SAMPLE, not the full migrated-column inventory —
 * see .superpowers/sdd/timestamp-inventory.md for the authoritative list of
 * every column touched by the migration. This script covers a cross-section
 * of tables (agreements, contacts, users, tenants, observer_links,
 * qbo_connections, report_versions, user_identity_links, inspection_units,
 * invoices, …) spanning the bare-ms, bare-seconds (*1000), mode:'timestamp'
 * (*1000), and text-retyped column families, to keep the gate fast and
 * readable rather than exhaustive.
 *
 * Usage:
 *   node scripts/check-ts-range.mjs <wrangler-db-name> [--remote]
 *   node scripts/check-ts-range.mjs DB            # local D1 (default)
 *   node scripts/check-ts-range.mjs DB --remote   # remote D1
 *
 * A table/column with zero matching rows is skipped (SKIP) — an empty
 * column passes vacuously since there is nothing out of range to find.
 */
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const [db, flag] = process.argv.slice(2);
if (!db) {
  console.error('Usage: node scripts/check-ts-range.mjs <wrangler-db-name> [--remote]');
  process.exit(1);
}
const remote = flag === '--remote' ? '--remote' : '--local';

// Config resolution mirrors scripts/wrangler.mjs (WRANGLER_CONFIG env >
// wrangler.local.jsonc > committed wrangler.jsonc).
const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

// Invoke wrangler's JS entry directly via `node` (no shell) rather than going
// through `npx`/`scripts/wrangler.mjs`'s `shell: true` spawn — a shell re-splits
// the `--command` SQL string on whitespace/parens on Windows, breaking the
// SQL into multiple bogus argv tokens. execFileSync with an explicit argv
// array keeps the SQL as one intact element.
const require = createRequire(import.meta.url);
const wranglerEntry = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

// ~2015-01-01 .. ~2035 in epoch milliseconds — a generous sentinel window,
// not calendar-precise bounds. Anything outside this range is almost
// certainly seconds (or some other unit) that slipped past the *1000 backfill.
const MIN = 1_420_000_000_000;
const MAX = 2_050_000_000_000;

// Representative sample (~24 of the ~68 migrated columns). See
// timestamp-inventory.md for the full per-column inventory and unit evidence.
const COLS = [
  ['agreements', 'created_at'],
  ['agreement_requests', 'signed_at'],
  ['contacts', 'created_at'],
  ['tenants', 'created_at'],
  ['users', 'created_at'],
  ['users', 'last_active_at'],
  ['observer_links', 'expires_at'],
  ['observer_links', 'revoked_at'],
  ['observer_links', 'last_viewed_at'],
  ['observer_links', 'created_at'],
  ['qbo_connections', 'token_expires_at'],
  ['qbo_connections', 'created_at'],
  ['report_versions', 'published_at'],
  ['report_versions', 'created_at'],
  ['user_identity_links', 'created_at'],
  ['inspection_units', 'created_at'],
  ['invoices', 'sent_at'],
  ['invoices', 'paid_at'],
  ['invoices', 'created_at'],
  ['signing_keys', 'created_at'],
  ['esign_audit_logs', 'created_at'],
  ['inspection_access_tokens', 'created_at'],
  ['inspection_access_tokens', 'expires_at'],
  ['notifications', 'created_at'],
];

let bad = 0;
for (const [t, c] of COLS) {
  const sql = `SELECT MIN(${c}) lo, MAX(${c}) hi FROM ${t} WHERE ${c} IS NOT NULL`;
  const out = execFileSync(
    process.execPath,
    [wranglerEntry, 'd1', 'execute', db, remote, '-c', cfg, '--json', '--command', sql],
    { encoding: 'utf8' },
  );
  const parsed = JSON.parse(out);
  const results = Array.isArray(parsed) ? parsed[0]?.results : parsed?.results;
  const { lo, hi } = results?.[0] ?? {};
  if (lo == null) {
    console.log(`SKIP ${t}.${c}: no rows`);
    continue;
  }
  if (lo < MIN || hi > MAX) {
    console.error(`RANGE FAIL ${t}.${c}: ${lo}..${hi}`);
    bad++;
  } else {
    console.log(`OK ${t}.${c}: ${lo}..${hi}`);
  }
}

if (bad) {
  console.error(`\ncheck:ts-range FAILED (${bad} column(s) out of range)`);
  process.exit(1);
}
console.log(`\ncheck:ts-range OK (${COLS.length} column(s) sampled)`);
