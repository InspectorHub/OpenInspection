#!/usr/bin/env node
/**
 * Raw-SQL seeder conformance gate.
 *
 * The seeders under `tests/` and `scripts/` talk to D1 in raw SQL strings, so
 * nothing type-checks them. When a column is renamed or dropped they keep
 * compiling, keep linting, and keep passing both unit suites — they fail only
 * when a real database rejects the statement, which for `tests/seed-fixtures.ts`
 * means the e2e globalSetup on CI, several minutes and one push later.
 *
 * That is not hypothetical. Removing `tenants.name` left FOUR raw-SQL seeders
 * still writing it, and the compiler saw none of them:
 *
 *   tests/seed-fixtures.ts          three inserts — found by CI, after a push
 *   scripts/seed-test-user.mjs      would fail on next use
 *   scripts/seed-pca-demo.mjs       would fail on next use
 *   scripts/lib/cloudflare-db.js    the CLI self-host setup path — and it was
 *                                   ALSO still writing `subdomain`, a column
 *                                   that had been gone far longer, so the first
 *                                   command a self-hoster ran had been failing
 *                                   with nobody upstream of them noticing
 *
 * The last one is the argument for this gate existing at pre-commit rather than
 * in CI: a seeder nothing runs automatically has no other rung that can ever
 * report it. It rots silently until a human hits it.
 *
 * Two rules, both aimed at that failure mode:
 *
 *   1. Every column named in a raw `INSERT INTO <t> (...)` or
 *      `UPDATE <t> SET col =` must exist on `<t>` in server/lib/db/schema.
 *      Unknown table -> skipped (D1 internals, portal-side tables).
 *   2. A file that writes a `timestamp_ms` column must not compute seconds
 *      (`Date.now() / 1000`). Drizzle stores milliseconds; seeding seconds is
 *      accepted silently by SQLite and renders as 1970.
 *
 * Escape hatch: `seed-lint-ok: <reason>` on the offending line.
 *
 * Ported from the portal repo, which grew it after `tenants.status` was dropped
 * out from under both of its seeders. Same defect, different column, one repo
 * later — which is the whole reason it is here now.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..');
const SCHEMA_DIR = join(ROOT, 'server/lib/db/schema');
const SCAN_DIRS = ['tests', 'scripts', 'server'];

/* ── Schema: physical table -> Set(physical columns), plus the ms-mode ones ── */

/**
 * Parse `sqliteTable('name', { ... })` blocks textually. Importing the schema
 * would need a TS loader; every other gate in this repo reads source the same
 * way, and the shape being read here is stable and mechanical.
 */
function readSchema() {
    const tables = new Map();      // table -> Set(column)
    const msColumns = new Map();   // table -> Set(column) declared timestamp_ms

    for (const file of walk(SCHEMA_DIR, /\.ts$/)) {
        const src = readFileSync(file, 'utf8');
        // Split on table declarations; each chunk owns the column definitions
        // that follow it, up to the next declaration.
        const parts = src.split(/sqliteTable\(\s*'([a-z0-9_]+)'/);
        for (let i = 1; i < parts.length; i += 2) {
            const table = parts[i];
            const body = parts[i + 1] ?? '';
            const cols = tables.get(table) ?? new Set();
            const ms = msColumns.get(table) ?? new Set();
            // `text('slug')`, `integer('created_at', { mode: 'timestamp_ms' })`.
            // Index/constraint helpers use different function names and carry no
            // column-name literal here, so they cannot leak in.
            for (const m of body.matchAll(/\b(?:text|integer|real|blob|numeric)\(\s*'([a-z0-9_]+)'([^\n]*)/g)) {
                cols.add(m[1]);
                if (/mode:\s*'timestamp_ms'/.test(m[2])) ms.add(m[1]);
            }
            tables.set(table, cols);
            msColumns.set(table, ms);
        }
    }
    return { tables, msColumns };
}

function walk(dir, re, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (e === 'node_modules' || e.startsWith('.')) continue;
        if (statSync(p).isDirectory()) walk(p, re, out);
        else if (re.test(e)) out.push(p);
    }
    return out;
}

/* ── Rule 1: columns named in raw INSERT / UPDATE must exist ── */

/** @returns {{table:string, column:string, index:number}[]} */
function rawSqlColumnRefs(src) {
    const refs = [];

    // INSERT [OR REPLACE|IGNORE] INTO <table> (a, b, c)
    for (const m of src.matchAll(/INSERT\s+(?:OR\s+\w+\s+)?INTO\s+"?([a-z0-9_]+)"?\s*\(([^)]*)\)/gi)) {
        for (const raw of m[2].split(',')) {
            const column = raw.trim().replace(/^["'`]|["'`]$/g, '');
            if (/^[a-z0-9_]+$/i.test(column)) {
                refs.push({ table: m[1], column, index: m.index });
            }
        }
    }

    // UPDATE <table> SET col = ..., col2 = ...
    for (const m of src.matchAll(/UPDATE\s+"?([a-z0-9_]+)"?\s+SET\s+([^;`]*)/gi)) {
        for (const assignment of m[2].split(',')) {
            const column = assignment.split('=')[0]?.trim().replace(/^["'`]|["'`]$/g, '') ?? '';
            if (/^[a-z0-9_]+$/i.test(column)) {
                refs.push({ table: m[1], column, index: m.index });
            }
        }
    }

    return refs;
}

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

export function findSeedSqlViolations(src, filename, schema) {
    const out = [];
    const lines = src.split('\n');
    const allowed = (line) => /seed-lint-ok:/.test(lines[line - 1] ?? '');

    const touchedMsColumns = [];

    for (const { table, column, index } of rawSqlColumnRefs(src)) {
        const columns = schema.tables.get(table);
        if (!columns) continue;  // not one of ours (D1 internals, portal-side)
        const line = lineOf(src, index);
        if (!columns.has(column)) {
            if (allowed(line)) continue;
            out.push(
                `${filename}:${line} writes ${table}.${column}, which does not exist in the schema`,
            );
        } else if (schema.msColumns.get(table)?.has(column)) {
            touchedMsColumns.push({ table, column, line });
        }
    }

    // Rule 2 — seconds into a millisecond column.
    if (touchedMsColumns.length > 0) {
        const secondsAt = src.split('\n').findIndex(l =>
            /Date\.now\(\)\s*\/\s*1000/.test(l) && !/seed-lint-ok:/.test(l));
        if (secondsAt !== -1) {
            const { table, column } = touchedMsColumns[0];
            out.push(
                `${filename}:${secondsAt + 1} computes SECONDS (Date.now() / 1000) but this file ` +
                `writes ${table}.${column}, which is timestamp_ms — the row will read as 1970`,
            );
        }
    }

    return out;
}

/* ── Runner ── */

const schema = readSchema();
// A gate that parsed nothing passes everything. Zero tables is a failure, not a
// skip — otherwise the day the schema directory moves is the day this stops
// checking anything and says so in green.
if (schema.tables.size === 0) {
    console.error('✘ Seed-SQL gate — parsed ZERO tables from server/lib/db/schema.');
    console.error('  The gate would pass vacuously, so this is a failure, not a skip.');
    process.exit(1);
}

const violations = [];
let scanned = 0;
let skipped = 0;
for (const dir of SCAN_DIRS) {
    for (const file of walk(join(ROOT, dir), /\.(mjs|js|ts)$/)) {
        const src = readFileSync(file, 'utf8');
        if (!/INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE\s+\w+\s+SET/i.test(src)) { skipped++; continue; }
        scanned++;
        violations.push(...findSeedSqlViolations(src, relative(ROOT, file).replaceAll('\\', '/'), schema));
    }
}

/* ── Baseline ──
 *
 * Turning this gate on found 20 violations that predate it, almost all of them
 * in `scripts/seed-pca-demo.mjs`, which writes a dozen columns that do not
 * exist — the demo seeder has been broken for a while and nothing said so.
 * They are frozen here rather than fixed in the same change that introduces the
 * gate, so that a NEW one fails immediately instead of waiting behind a
 * cleanup. The count is printed on every run, including green ones: a frozen
 * violation that stops being visible is just a violation.
 */
const BASELINE_PATH = join(ROOT, 'scripts/seed-sql-baseline.json');
const updating = process.argv.includes('--update');

let baseline = [];
if (!updating) {
    try {
        baseline = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    } catch (err) {
        // Unreadable baseline = fail closed. "I could not find the list of known
        // problems" must never read the same as "there are no problems."
        console.error(`✘ Seed-SQL gate — cannot read ${relative(ROOT, BASELINE_PATH)}: ${err.message}`);
        console.error('  Failing closed: an unreadable baseline cannot be treated as an empty one.');
        process.exit(1);
    }
}

if (updating) {
    writeFileSync(BASELINE_PATH, `${JSON.stringify(violations.sort(), null, 4)}\n`, 'utf8');
    console.log(`Updated ${relative(ROOT, BASELINE_PATH)}: ${violations.length} baseline entries.`);
    process.exit(0);
}

const known = new Set(baseline);
const fresh = violations.filter(v => !known.has(v));
const stale = baseline.filter(v => !violations.includes(v));

if (fresh.length > 0) {
    console.error(`✘ Seed-SQL gate — ${fresh.length} NEW violation(s) (${known.size} baselined):`);
    for (const v of fresh) console.error(`  ✘ ${v}`);
    console.error('\n  Raw SQL is not type-checked. Fix the column, or annotate the line');
    console.error('  with `seed-lint-ok: <reason>` if the table genuinely is not ours.');
    console.error('  Deliberately accepting it instead: node scripts/check-seed-sql.mjs --update');
    process.exit(1);
}

// Both numbers, every run: a gate that only ever prints a verdict is one nobody
// can check on the day it goes quiet. The baselined count is part of that — it
// is the number that should be going DOWN.
console.log(
    `✅ Seed-SQL gate — ${scanned} raw-SQL file(s) checked against ${schema.tables.size} tables; ` +
    `0 new, ${known.size} baselined, ${skipped} file(s) carried no raw SQL.`,
);
if (stale.length > 0) {
    console.log(`   ${stale.length} baseline entr(y/ies) no longer reproduce — drop them with --update.`);
}
