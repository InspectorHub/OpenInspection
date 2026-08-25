#!/usr/bin/env node
/**
 * How close each table is to the wall D1 puts up at 100 columns.
 *
 * ## The failure this exists to prevent
 *
 * `tenant_configs` reached 100 columns on 2026-08-25. Adding the 101st made D1
 * refuse the CREATE outright, and the way that was discovered is the point:
 * a workers spec failed, in real workerd, on a table it could no longer build.
 * Room was made by deleting a legacy column that happened to be droppable — a
 * one-off that leaves the next person with the same wall and nothing to trade.
 *
 * Nothing in the tree knew the limit existed. `db:check` compares the schema
 * against the migrations and is happy with 101 columns in both; the naming and
 * timestamp gates read one column at a time. **The number that matters is a
 * property of the TABLE, and no gate was counting it.**
 *
 * ## Two rules, because one number cannot say both things
 *
 *   HARD — no table may exceed 100 columns. That is D1's limit, not a policy,
 *   and a table over it cannot be created at all.
 *
 *   RATCHET — a table already at or above `CROWDED` may not gain a column.
 *   Without this the gate only speaks on the day the wall is hit, which is
 *   exactly the day it is most expensive to hear: by then the table is in
 *   production and the fix is a multi-migration extraction rather than a
 *   decision about where a new column belongs.
 *
 * The baseline records each crowded table's current width. Growing one is a
 * failure; shrinking one is expected to be followed by `--update`, and the gate
 * says so rather than leaving a stale number to drift.
 *
 * ⚠️ Counting is done on the SCHEMA, which is authoritative here — the
 * migrations are generated from it. The hand-written inline DDL under
 * `tests/helpers/` is a second copy of one table and is checked for agreement
 * by its own spec, not by this gate.
 *
 *   node scripts/check-column-ceiling.mjs            # gate
 *   node scripts/check-column-ceiling.mjs --update   # re-take the baseline
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SCHEMA_DIR = join(ROOT, 'server', 'lib', 'db', 'schema');
const BASELINE = join(ROOT, 'scripts', 'column-ceiling-baseline.json');
const UPDATE = process.argv.includes('--update');

/** D1 refuses a CREATE TABLE wider than this. Not ours to choose. */
const HARD_LIMIT = 100;

/**
 * Where the ratchet starts. Deliberately below the limit: a table with ten
 * columns of headroom is one release away from having none, and the moment to
 * argue about a new column is while there is still somewhere else to put it.
 */
const CROWDED = 85;

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const abs = join(dir, entry);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else if (abs.endsWith('.ts')) out.push(abs);
    }
    return out;
}

/** Every `sqliteTable('name', { … })` in one file, with its column count. */
function tablesIn(source) {
    const found = [];
    const opener = /sqliteTable\(\s*'([a-z_0-9]+)'/g;
    let m;
    while ((m = opener.exec(source))) {
        const name = m[1];
        // Balance from the opening paren of the sqliteTable call, so a nested
        // object or a call inside a column definition cannot end the table
        // early. A regex that stopped at the first `})` reported a fraction of
        // the columns and would have passed this table at any width.
        let i = source.indexOf('(', m.index);
        let depth = 0;
        let end = i;
        for (; end < source.length; end++) {
            const ch = source[end];
            if (ch === '(') depth++;
            else if (ch === ')') { depth--; if (depth === 0) break; }
        }
        const body = source.slice(i, end);
        const columns = body.match(/^\s+[a-zA-Z][a-zA-Z0-9]*\s*:\s*(?:text|integer|real|blob)\(/gm) ?? [];
        found.push({ name, columns: columns.length });
    }
    return found;
}

const files = existsSync(SCHEMA_DIR) ? walk(SCHEMA_DIR) : [];
const tables = files.flatMap((f) => tablesIn(readFileSync(f, 'utf8')));

// 🔴 Zero examined is an instrument failure, not a clean tree. A schema
// directory that moved, or a parse that stopped matching, would otherwise
// report every table comfortably under the limit on the day it went blind.
if (tables.length === 0) {
    console.error(
        'column-ceiling: found ZERO tables under server/lib/db/schema.\n'
        + '  That is not a pass. Far likelier the directory moved or the parser\n'
        + '  stopped matching — check both before believing this.',
    );
    process.exit(1);
}

const byWidth = [...tables].sort((a, b) => b.columns - a.columns);
const crowded = byWidth.filter((t) => t.columns >= CROWDED);

if (UPDATE) {
    const next = Object.fromEntries(crowded.map((t) => [t.name, t.columns]));
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`column-ceiling: baseline re-taken — ${crowded.length} table(s) at or above ${CROWDED} columns`);
    process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : {};

// Both numbers on every run, green or not: how many tables were counted, and
// how many are near the wall. A gate that prints only its verdict cannot be
// checked on the day it is wrong.
console.log(
    `column-ceiling: counted ${tables.length} table(s) · `
    + `${crowded.length} at or above ${CROWDED} columns · hard limit ${HARD_LIMIT}`,
);
for (const t of byWidth.slice(0, 5)) {
    const head = HARD_LIMIT - t.columns;
    console.log(`    ${String(t.columns).padStart(3)}  ${t.name.padEnd(28)} ${head} column(s) of headroom`);
}

const problems = [];
for (const t of byWidth) {
    if (t.columns > HARD_LIMIT) {
        problems.push(
            `${t.name} has ${t.columns} columns — D1 refuses a CREATE TABLE above ${HARD_LIMIT}. `
            + 'This table cannot be built, in workerd or in production.',
        );
        continue;
    }
    const was = baseline[t.name];
    if (was !== undefined && t.columns > was) {
        problems.push(
            `${t.name} grew from ${was} to ${t.columns} columns, and it is already within `
            + `${HARD_LIMIT - t.columns} of the limit. Put the new field somewhere else — a table of `
            + 'its own, keyed by the same id — or extract a family from this one first.',
        );
    }
}

const shrank = Object.entries(baseline)
    .filter(([name, was]) => {
        const now = byWidth.find((t) => t.name === name);
        return now && now.columns < was;
    })
    .map(([name, was]) => `${name}: ${was} → ${byWidth.find((t) => t.name === name).columns}`);
if (shrank.length) {
    console.log('  Narrowed since the baseline — run --update to tighten the ratchet:');
    for (const s of shrank) console.log(`    ✓ ${s}`);
}

if (problems.length) {
    console.error(`\n✘ column-ceiling — ${problems.length} problem(s):`);
    for (const p of problems) console.error(`    ✘ ${p}`);
    console.error(
        '\n  A wide table is not a style question here. D1 stops at a hard number,\n'
        + '  and a table that reaches it in production can only be narrowed by an\n'
        + '  expand-migrate-contract sequence spanning several deploys.',
    );
    process.exit(1);
}

console.log('✓ Every table is inside D1\'s column limit, and no crowded table grew.');
