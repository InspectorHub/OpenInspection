#!/usr/bin/env node
/**
 * Live drift gate (`db:check`): prove the Drizzle schema and the committed
 * migrations/ produce the SAME structural schema (columns / types / constraints
 * / indexes / FKs — semantic, not DDL text). Regenerates a baseline from the
 * schema into drizzle-tmp/ and diffs its PRAGMA introspection against
 * migrations/. KNOWN_ACCEPTED (below) is the audited allowlist for divergences
 * that cannot be reconciled on D1 — empty after the 2026-06-21 baseline rebuild.
 *
 *   node scripts/verify-migration-equivalence.mjs
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();

// ---------------------------------------------------------------------------
// Known-accepted drift allowlist.
//
// These are intentional, documented divergences between migrations/ (the
// physical D1 reality) and the Drizzle schema (the semantic source of truth)
// that CANNOT be reconciled on Cloudflare D1 — SQLite cannot ALTER a column
// default and D1 cannot rebuild an FK-referenced table (no PRAGMA
// foreign_keys=OFF on remote), nor cleanly drop tables created in the
// collapsed baseline. They are frozen by design and enforced by code review,
// not DDL. Every entry below must cite WHY it is unfixable so this list never
// becomes a dumping ground for real drift.
//
// The gate still FAILS on any drift NOT in this list (including a schema table
// with no migration). Adding to this list is a deliberate, reviewed decision.
const KNOWN_ACCEPTED = {
  // Tables present in migrations but removed from schema. Kept EMPTY: the
  // pre-launch baseline rebuild (2026-06-21) regenerated migrations/ from the
  // schema, so no orphan tables remain. Re-add only with a cited, D1-unfixable
  // reason — this list is the audited escape hatch, never a dumping ground.
  lostTables: new Set([]),
  // Per-table column-signature diffs accepted as D1-unfixable. Kept EMPTY for
  // the same reason — frozen defaults were created correct in the fresh
  // baseline, not ALTERed. Re-add only with a cited reason.
  colDiffs: {},
};

// Regenerate the baseline from the CURRENT Drizzle schema so this doubles as a
// live drift gate (db:check): migrations/ vs schema must stay structurally equal.
console.log('Regenerating baseline from server/lib/db/schema…');
rmSync(join(root, 'drizzle-tmp'), { recursive: true, force: true });
execSync('npx drizzle-kit generate --config drizzle.config.trial.ts', { cwd: root, stdio: 'ignore' });

function applyDir(dir, files) {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = OFF');
  for (const f of files) {
    const sql = readFileSync(join(root, dir, f), 'utf8');
    try { db.exec(sql); }
    catch (e) { console.error(`  ✘ ${dir}/${f}: ${e.message}`); throw e; }
  }
  return db;
}

function structure(db) {
  const tables = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '\\_%' ESCAPE '\\' ORDER BY name"
  ).all().map((r) => r.name);
  const out = {};
  // Normalize SQLite/Drizzle cosmetic equivalences so only REAL drift surfaces:
  //  - boolean default `false`/`true` ≡ `0`/`1`
  //  - TEXT PRIMARY KEY: drizzle emits NOT NULL, hand-SQL omits it → equivalent for a PK
  const normDflt = (v) => (v ?? '').toString().replace(/\s+/g, '').toLowerCase()
    .replace(/^false$/, '0').replace(/^true$/, '1');
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info('${t}')`).all()
      .map((c) => `${c.name}:${c.type.toUpperCase()}:nn=${c.pk ? 'pk' : c.notnull}:pk=${c.pk}:dflt=${normDflt(c.dflt_value)}`)
      .sort();
    const fks = db.prepare(`PRAGMA foreign_key_list('${t}')`).all()
      .map((f) => `${f.from}->${f.table}.${f.to}:on_del=${f.on_delete}`)
      .sort();
    const idxRows = db.prepare(`PRAGMA index_list('${t}')`).all();
    const idx = idxRows.map((i) => {
      const cols = db.prepare(`PRAGMA index_info('${i.name}')`).all().map((x) => x.name).join(',');
      return `uniq=${i.unique}:[${cols}]`;
    }).sort();
    out[t] = { cols, fks, idx };
  }
  return out;
}

const migDir = 'migrations';
const migFiles = readdirSync(join(root, migDir)).filter((f) => f.endsWith('.sql')).sort();
const genDir = 'drizzle-tmp';
const genFiles = readdirSync(join(root, genDir)).filter((f) => f.endsWith('.sql')).sort();

console.log(`Applying ${migFiles.length} hand-written migrations…`);
const A = structure(applyDir(migDir, migFiles));
console.log(`Applying ${genFiles.length} generated baseline…`);
const B = structure(applyDir(genDir, genFiles));

const tablesA = Object.keys(A), tablesB = Object.keys(B);
const onlyA = tablesA.filter((t) => !B[t]);
const onlyB = tablesB.filter((t) => !A[t]);
console.log(`\nTables: hand=${tablesA.length} generated=${tablesB.length}`);

// Partition lost tables into known-accepted vs unexpected.
const acceptedLost = onlyA.filter((t) => KNOWN_ACCEPTED.lostTables.has(t));
const unexpectedLost = onlyA.filter((t) => !KNOWN_ACCEPTED.lostTables.has(t));
if (unexpectedLost.length) console.log(`  ✘ ONLY in hand-written (LOST, UNEXPECTED): ${unexpectedLost.join(', ')}`);
// A schema table with no migration is always a real failure (needs db:generate).
if (onlyB.length) console.log(`  ✘ ONLY in generated (NEW table, MISSING migration): ${onlyB.join(', ')}`);

let diffs = 0;          // unexpected, actionable diffs
const accepted = [];    // known-accepted diffs, reported but not failing
for (const t of tablesA) {
  if (!B[t]) continue;
  for (const key of ['cols', 'fks', 'idx']) {
    const a = A[t][key], b = B[t][key];
    let missA = a.filter((x) => !b.includes(x));
    let missB = b.filter((x) => !a.includes(x));
    // Strip known-accepted column-default divergences for this table.
    const allow = key === 'cols' ? KNOWN_ACCEPTED.colDiffs[t] : undefined;
    if (allow) {
      const okA = missA.filter((x) => allow.handOnly.includes(x));
      const okB = missB.filter((x) => allow.generatedOnly.includes(x));
      if (okA.length || okB.length) accepted.push(`${t}.${key} (frozen default)`);
      missA = missA.filter((x) => !allow.handOnly.includes(x));
      missB = missB.filter((x) => !allow.generatedOnly.includes(x));
    }
    if (missA.length || missB.length) {
      diffs++;
      console.log(`\n  ✘ ${t}.${key} differs (UNEXPECTED):`);
      if (missA.length) console.log(`     hand-only:      ${missA.join(' | ')}`);
      if (missB.length) console.log(`     generated-only: ${missB.join(' | ')}`);
    }
  }
}

if (acceptedLost.length || accepted.length) {
  console.log('\n  Known-accepted drift (frozen on D1 by design — see allowlist):');
  for (const t of acceptedLost) console.log(`     · lost table ${t} (orphaned subsystem)`);
  for (const a of accepted) console.log(`     · ${a}`);
}

const unexpected = diffs + unexpectedLost.length + onlyB.length;
if (unexpected === 0) {
  const extra = acceptedLost.length + accepted.length;
  console.log(`\n✅ No unexpected drift${extra ? ` (${extra} known-accepted exception${extra === 1 ? '' : 's'})` : ''} — migrations and schema are in sync.`);
  process.exit(0);
} else {
  console.log(`\n⚠️  ${unexpected} UNEXPECTED drift item(s) — resolve (db:generate) or, if truly unfixable on D1, add to the KNOWN_ACCEPTED allowlist with a cited reason.`);
  process.exit(1);
}
