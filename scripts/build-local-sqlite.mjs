#!/usr/bin/env node
/**
 * Apply all migrations/*.sql to a fresh sqlite FILE so drizzle-kit can
 * introspect the real, fully-migrated schema. One-off helper for the
 * schema-first adoption.
 *
 *   node scripts/build-local-sqlite.mjs [outFile]
 */
import Database from 'better-sqlite3';
import { readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const out = process.argv[2] || join(root, 'drizzle-introspect-db.sqlite');
if (existsSync(out)) rmSync(out);

const db = new Database(out);
db.pragma('foreign_keys = OFF');
const files = readdirSync(join(root, 'migrations')).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) {
  db.exec(readFileSync(join(root, 'migrations', f), 'utf8'));
}
const n = db.prepare("SELECT count(*) c FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").get().c;
db.close();
console.log(`✓ applied ${files.length} migrations -> ${out} (${n} tables)`);
