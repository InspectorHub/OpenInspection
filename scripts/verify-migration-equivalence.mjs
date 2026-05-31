#!/usr/bin/env node
/**
 * One-off verification: prove the drizzle-generated baseline produces the SAME
 * structural schema as the existing hand-written migrations, before we replace
 * migrations/ with the generated baseline. Compares columns/types/constraints/
 * indexes/FKs (semantic, not DDL text).
 *
 *   node scripts/verify-migration-equivalence.mjs
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

const root = process.cwd();

// Regenerate the baseline from the CURRENT Drizzle schema so this doubles as a
// live drift gate (db:check): migrations/ vs schema must stay structurally equal.
console.log('Regenerating baseline from src/lib/db/schema…');
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
if (onlyA.length) console.log(`  ONLY in hand-written (LOST if we switch): ${onlyA.join(', ')}`);
if (onlyB.length) console.log(`  ONLY in generated (NEW): ${onlyB.join(', ')}`);

let diffs = 0;
for (const t of tablesA) {
  if (!B[t]) continue;
  for (const key of ['cols', 'fks', 'idx']) {
    const a = A[t][key], b = B[t][key];
    const missA = a.filter((x) => !b.includes(x));
    const missB = b.filter((x) => !a.includes(x));
    if (missA.length || missB.length) {
      diffs++;
      console.log(`\n  ▲ ${t}.${key} differs:`);
      if (missA.length) console.log(`     hand-only:      ${missA.join(' | ')}`);
      if (missB.length) console.log(`     generated-only: ${missB.join(' | ')}`);
    }
  }
}
console.log(`\n${diffs === 0 && !onlyA.length ? '✅ EQUIVALENT — safe to re-baseline' : `⚠️  ${diffs} table-diffs + ${onlyA.length} lost tables — resolve before switching`}`);
