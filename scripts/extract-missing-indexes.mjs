#!/usr/bin/env node
/**
 * One-off: diff indexes between the introspected schema (accurate, from
 * migrations) and the curated src/lib/db/schema, and print the missing index
 * declarations grouped by the curated file that owns each table. Helper for
 * the schema-first reconciliation (Path A).
 *
 *   node scripts/extract-missing-indexes.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const introspect = readFileSync(join(root, 'drizzle-introspect/schema.ts'), 'utf8');

// Parse introspected: each `sqliteTable("name", {...}, (table) => [ ...idx... ])`.
// Extract index/uniqueIndex declarations per table.
const tableRe = /sqliteTable\("([^"]+)",\s*\{[\s\S]*?\},\s*\(table\) => \[([\s\S]*?)\]\s*\)/g;
const idxRe = /(uniqueIndex|index)\("([^"]+)"\)\.on\(([^)]*)\)/g;
const introTables = {};
let m;
while ((m = tableRe.exec(introspect))) {
  const [, tname, body] = m;
  const idxs = [];
  let im;
  while ((im = idxRe.exec(body))) {
    const cols = im[3].split(',').map((c) => c.trim().replace(/^table\./, '')).filter(Boolean);
    idxs.push({ kind: im[1], name: im[2], cols });
  }
  if (idxs.length) introTables[tname] = idxs;
}

// Map each table -> curated file + existing index names.
const schemaDir = join(root, 'src/lib/db/schema');
const files = readdirSync(schemaDir).filter((f) => f.endsWith('.ts') && f !== 'index.ts');
const tableFile = {};
const curatedIdxNames = {};
for (const f of files) {
  const src = readFileSync(join(schemaDir, f), 'utf8');
  let tm;
  const tdef = /sqliteTable\('([^']+)'/g;
  while ((tm = tdef.exec(src))) tableFile[tm[1]] = f;
  let nm;
  const inm = /(?:uniqueIndex|index)\('([^']+)'\)/g;
  while ((nm = inm.exec(src))) (curatedIdxNames[f] ??= new Set()).add(nm[1]);
}

let totalMissing = 0;
const byFile = {};
for (const [tname, idxs] of Object.entries(introTables)) {
  const file = tableFile[tname] || '??? (table not in any curated file)';
  const have = curatedIdxNames[file] || new Set();
  const missing = idxs.filter((i) => !have.has(i.name));
  if (!missing.length) continue;
  (byFile[file] ??= []).push({ tname, missing });
  totalMissing += missing.length;
}

for (const [file, tables] of Object.entries(byFile).sort()) {
  console.log(`\n### ${file}`);
  for (const { tname, missing } of tables) {
    console.log(`  // ${tname}`);
    for (const i of missing) {
      console.log(`  ${i.kind}('${i.name}').on(${i.cols.map((c) => 't.' + c).join(', ')}),`);
    }
  }
}
console.log(`\n=== ${totalMissing} missing indexes across ${Object.keys(byFile).length} files ===`);
