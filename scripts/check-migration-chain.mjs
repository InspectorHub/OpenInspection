#!/usr/bin/env node
/**
 * Drizzle meta-chain gate (`lint:migchain`).
 *
 * Every `migrations/meta/NNNN_snapshot.json` must exist and its `prevId` must
 * name the previous snapshot's `id`. drizzle-kit walks that chain to diff the
 * schema, so a single missing or mislinked snapshot makes `db:generate` refuse
 * to run at all:
 *
 *     Error: [meta/0021_snapshot.json, meta/0023_snapshot.json] are pointing to
 *     a parent snapshot: meta/0021_snapshot.json/snapshot.json which is a collision.
 *
 * This rotted unnoticed for two migrations because nothing checked it. `db:check`
 * does not: it applies the SQL and compares the resulting TABLES, so a chain that
 * drizzle-kit cannot walk still produces a correct database and a green gate. The
 * two checks answer different questions — "do the migrations build the schema"
 * versus "can drizzle still author the next one" — and only the first had a gate.
 *
 * Hand-written migrations are the usual cause: a data-only migration ships with
 * no snapshot (it changes no DDL, so it feels like it needs none), and the next
 * generated one then links past it. A data migration still needs a link — its
 * snapshot is simply its predecessor's schema under a new id.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const metaDir = join(root, 'migrations', 'meta');
const journal = JSON.parse(readFileSync(join(metaDir, '_journal.json'), 'utf8'));

const problems = [];
let prev = null;

journal.entries.forEach((entry, i) => {
  const file = join(metaDir, `${String(i).padStart(4, '0')}_snapshot.json`);
  if (!existsSync(file)) {
    problems.push(
      `${entry.tag}: no snapshot at meta/${String(i).padStart(4, '0')}_snapshot.json.\n` +
        `      A data-only migration still needs one — copy its predecessor's snapshot,\n` +
        `      give it a fresh id, and point prevId at the predecessor.`,
    );
    prev = null; // chain is severed; do not cascade a second error onto the next entry
    return;
  }
  const snap = JSON.parse(readFileSync(file, 'utf8'));
  if (prev !== null && snap.prevId !== prev.id) {
    problems.push(
      `${entry.tag}: prevId is ${snap.prevId}, but the previous snapshot ` +
        `(${prev.tag}) has id ${prev.id}.`,
    );
  }
  prev = { id: snap.id, tag: entry.tag };
});

const seen = new Map();
journal.entries.forEach((entry, i) => {
  const file = join(metaDir, `${String(i).padStart(4, '0')}_snapshot.json`);
  if (!existsSync(file)) return;
  const { id } = JSON.parse(readFileSync(file, 'utf8'));
  if (seen.has(id)) problems.push(`${entry.tag}: duplicate snapshot id ${id} (also ${seen.get(id)}).`);
  else seen.set(id, entry.tag);
});

if (problems.length) {
  console.error('[migchain] FAIL — the drizzle meta chain is broken:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\n  While it is broken, `npm run db:generate` cannot run.');
  process.exit(1);
}

console.log(`[migchain] OK — ${journal.entries.length} snapshots, chain intact.`);
