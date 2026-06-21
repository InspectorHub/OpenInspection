#!/usr/bin/env node
/**
 * Wipe a D1 database: DELETE all rows, then DROP every user table (and the
 * wrangler `d1_migrations` bookkeeping table) so a single regenerated
 * `0000_baseline.sql` can be applied cleanly by `wrangler d1 migrations apply`.
 *
 * Pre-launch reset ONLY — this DESTROYS ALL DATA. Config resolution mirrors
 * scripts/wrangler.mjs (WRANGLER_CONFIG > wrangler.local.jsonc > wrangler.jsonc).
 *
 *   node scripts/wipe-d1.mjs --local
 *   node scripts/wipe-d1.mjs --remote
 *   WRANGLER_CONFIG=wrangler.saas.jsonc node scripts/wipe-d1.mjs --remote
 *
 * FK handling: `PRAGMA defer_foreign_keys=true` delays enforcement to the end of
 * wrangler's batch transaction — by which point every table is dropped, so there
 * is nothing left to violate. (`PRAGMA foreign_keys=OFF` is a no-op inside D1's
 * implicit transaction, and an alphabetical DELETE/DROP order trips FK while
 * legacy FK-referenced parents still have referring child rows.)
 */
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const args = process.argv.slice(2);
const isRemote = args.includes('--remote');
const isLocal = args.includes('--local');
if (isRemote === isLocal) {
  console.error('Specify exactly one of --local or --remote.');
  process.exit(1);
}
const scope = isRemote ? '--remote' : '--local';
const cfg =
  process.env.WRANGLER_CONFIG ||
  (existsSync('wrangler.local.jsonc') ? 'wrangler.local.jsonc' : 'wrangler.jsonc');

// Invoke wrangler's JS entry directly via `node` — NOT `npx`. execFileSync with
// no shell keeps the introspection SQL (quotes + `%`) as one intact argv element
// (the PS-quoting trap this plan warns about); `npx`/`npx.cmd` would either be
// unresolvable (spawnSync ENOENT) or hit Node's no-shell `.cmd` block (EINVAL).
const require = createRequire(import.meta.url);
const wranglerEntry = join(dirname(require.resolve('wrangler/package.json')), 'bin', 'wrangler.js');

const wrangler = (extra) =>
  execFileSync(process.execPath, [wranglerEntry, 'd1', 'execute', 'DB', scope, '-c', cfg, ...extra], {
    encoding: 'utf8',
  });

// 1. Introspect every user table (exclude SQLite + Cloudflare internal tables).
const listSql =
  "SELECT name FROM sqlite_master WHERE type='table' " +
  "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name;";
const parsed = JSON.parse(wrangler(['--json', '--yes', '--command', listSql]));
const rows = Array.isArray(parsed) ? (parsed[0]?.results ?? []) : (parsed?.results ?? []);
const tables = rows.map((r) => r.name).filter((n) => n && n !== 'd1_migrations');

if (!tables.length) {
  console.log(`No user tables on ${scope} (config ${cfg}) — nothing to wipe.`);
  process.exit(0);
}

// 2. Build the wipe SQL: defer FK enforcement, then DROP every table (the
// implicit row-delete inside DROP is order-independent under deferral) plus the
// d1_migrations ledger so a single baseline re-applies as migration 0.
const lines = ['PRAGMA defer_foreign_keys = true;'];
for (const t of tables) lines.push(`DROP TABLE IF EXISTS "${t}";`);
lines.push('DROP TABLE IF EXISTS "d1_migrations";');

const tmp = join(process.cwd(), `.wipe-d1.${isRemote ? 'remote' : 'local'}.sql`);
writeFileSync(tmp, lines.join('\n') + '\n');
try {
  console.log(`Wiping ${tables.length} table(s) on ${scope} (config ${cfg})…`);
  wrangler(['--file', tmp, '--yes']);
  console.log('✓ D1 wiped — run `db:migrate` / `db:migrate:remote` to apply 0000_baseline.sql.');
} finally {
  rmSync(tmp, { force: true });
}
