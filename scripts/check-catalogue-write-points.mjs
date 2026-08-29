#!/usr/bin/env node
/**
 * Only the seeder may write what a marketplace catalogue entry CONTAINS.
 *
 * ── What rests on this ──────────────────────────────────────────────────────
 * The import path for a statutory catalogue entry validates with a schema that
 * admits a statutory-form declaration, where the tenant-facing template schema
 * refuses one. That relaxation is the single place this design opens anything,
 * and it is safe for exactly one reason: the catalogue is not reachable from
 * user input. Every write to `marketplace_libraries` today is either the seeder
 * — whose content comes from source control and a code review — or a
 * `downloadCount` increment, which is a counter and carries nothing.
 *
 * Nothing but this gate holds that. Without it the relaxed validator is one
 * convenience endpoint away from being a door anyone can walk through, and the
 * endpoint would look perfectly reasonable on its own: "let an admin edit a
 * catalogue entry" is a sentence somebody writes without ever seeing the
 * validator it disarms.
 *
 * ── Content vs visibility ───────────────────────────────────────────────────
 * `downloadCount` is the tenants' own history, `updatedAt` records when a row
 * moved, and `delistedAt` says whether the catalogue still OFFERS the row. None
 * of the three says what a pack IS, and only what a pack IS reaches the relaxed
 * validator: `assertStatutorySchema` reads `schema` and nothing else, so no
 * value any of these three can take changes what that validator admits.
 *
 * `delistedAt` is named here deliberately rather than discovered. Its writer is
 * `setCatalogueDelisted`, behind the platform M2M guard with no workspace-facing
 * route, and delisting is the same shape as un-installing: visibility changes,
 * content does not. The exemption is per COLUMN and not per file — naming the
 * file instead would let that same file write `schema` with the gate silent,
 * which is the reach this whole check exists to deny.
 *
 * Every other column says what a pack is, so the rule stays an allow-list — a
 * deny-list would silently admit the next column somebody adds, which is
 * precisely the column a new capability arrives with.
 *
 * ── Why the seeder is a positive control, not just an exemption ─────────────
 * A matcher that has stopped recognising a write reports a clean scan, and a
 * clean scan is what this gate prints when everything is fine. So the seeder's
 * OWN write has to be visible to the same matcher: if the gate cannot see the
 * one write it knows exists, a clean result over everything else means nothing.
 *
 * ⚠️ That control caught nothing when this gate read `.set()` payloads with a
 * regex that required a colon: `.set({ delistedAt, updatedAt: now })` reported
 * the columns `["updatedAt"]` and `.set({ semver, schema, kind })` reported
 * NONE, so a whole-content write in shorthand read as "not a content write".
 * The seeder writes with `batchInsert`, so the control stayed green throughout.
 * The payload is therefore scanned rather than pattern-matched now, and the
 * scanner is scored against fixtures on every ordinary run — including the
 * shorthand case that was blind.
 *
 *   node scripts/check-catalogue-write-points.mjs
 */
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_DIR = join(ROOT, 'server');

/** The one file allowed to write what a catalogue entry contains. */
const SEEDER = 'server/services/starter-content/seed-marketplace-libraries.ts';

/**
 * Columns that are NOT content: a counter, the row's own mtime, and whether the
 * catalogue still offers the row. See the header for why the third one is on
 * this list and why the exemption is per column rather than per file.
 */
const NON_CONTENT_COLUMNS = new Set(['downloadCount', 'updatedAt', 'delistedAt']);

const TABLE = 'marketplaceLibraries';

/**
 * Comments first. Every file in this area explains the rule in prose — this one
 * included — and a raw match would read "only the seeder may insert
 * marketplaceLibraries" as an insert. Negated sentences are the worst case and
 * they are exactly the sentences this rule attracts.
 */
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Balanced-paren slice starting at the `(` at `open`, or null if unbalanced. */
function balanced(code, open) {
    if (code[open] !== '(') return null;
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
        if (code[i] === '(') depth += 1;
        else if (code[i] === ')') {
            depth -= 1;
            if (depth === 0) return code.slice(open + 1, i);
        }
    }
    return null;
}

/**
 * Index of the closing quote of the string literal opening at `start`, or -1
 * when it never closes.
 *
 * Template literals are followed through their `${…}` holes, because those holes
 * carry braces and quotes of their own — `sql`${t.downloadCount} + 1`` is the
 * payload this gate reads most often, and a scanner that counted its braces as
 * object braces would lose the object.
 */
function skipString(src, start) {
    const quote = src[start];
    for (let i = start + 1; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === '\\') { i += 1; continue; }
        if (quote === '`' && ch === '$' && src[i + 1] === '{') {
            let depth = 1;
            i += 2;
            for (; i < src.length && depth > 0; i += 1) {
                const c = src[i];
                if (c === '"' || c === "'" || c === '`') {
                    const end = skipString(src, i);
                    if (end === -1) return -1;
                    i = end;
                    continue;
                }
                if (c === '{') depth += 1;
                else if (c === '}') depth -= 1;
            }
            if (depth !== 0) return -1;
            i -= 1;
            continue;
        }
        if (ch === quote) return i;
    }
    return -1;
}

/**
 * The property NAMES a `.set(…)` payload writes, or null when the payload could
 * not be read.
 *
 * ⚠️ SHORTHAND IS A PROPERTY. `{ delistedAt, updatedAt: now }` writes two
 * columns and `{ semver, schema, kind }` writes three; the earlier reader
 * required a colon and so reported one and none. A column it cannot see is a
 * column exempt from the rule, and the exemption is invisible — the gate prints
 * the same clean line either way.
 *
 * Null rather than a partial list for anything this cannot name: a spread hides
 * whatever keys the spread object holds, and a computed or string key names a
 * column the scanner cannot resolve. Both are reported as unreadable at the call
 * site, which is a failure here — an unread payload looks exactly like a payload
 * that writes nothing.
 */
export function setColumns(payload, unwrap = true) {
    const segments = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < payload.length; i += 1) {
        const ch = payload[i];
        if (ch === '"' || ch === "'" || ch === '`') {
            const end = skipString(payload, i);
            if (end === -1) return null;
            current += payload.slice(i, end + 1);
            i = end;
            continue;
        }
        if (ch === '(' || ch === '{' || ch === '[') { depth += 1; current += ch; continue; }
        if (ch === ')' || ch === '}' || ch === ']') { depth -= 1; current += ch; continue; }
        if (ch === ',' && depth === 0) { segments.push(current); current = ''; continue; }
        current += ch;
    }
    segments.push(current);

    // The payload arrives as the balanced slice INSIDE `.set(`, so on the first
    // pass it is ONE segment with the object braces still on it. Unwrap and
    // re-scan; a payload that is not an object literal — `.set(payload)`, a
    // variable holding who-knows-what — is unreadable rather than one column
    // named after the variable.
    if (unwrap) {
        if (segments.length !== 1) return null;
        const only = segments[0].trim();
        if (!only.startsWith('{') || !only.endsWith('}')) return null;
        const inner = only.slice(1, -1);
        return inner.trim() === '' ? [] : setColumns(inner, false);
    }

    const columns = [];
    for (const seg of segments) {
        const s = seg.trim();
        if (s === '') continue;
        if (s.startsWith('...')) return null;
        const named = /^([A-Za-z_$][\w$]*)\s*:/.exec(s);
        if (named) { columns.push(named[1]); continue; }
        const shorthand = /^([A-Za-z_$][\w$]*)$/.exec(s);
        if (shorthand) { columns.push(shorthand[1]); continue; }
        return null;
    }
    return [...new Set(columns)];
}

/**
 * Every write to the catalogue in one file's CODE.
 *
 * Returns `{ kind, columns }` per site. `kind` is the verb; `columns` is what a
 * `.set()` names, or null when the payload could not be read — which is a
 * failure at the call site, never a shrug.
 */
export function catalogueWrites(source) {
    const code = stripComments(source);
    const sites = [];

    // insert / delete: the whole row, so the columns question does not arise.
    for (const m of code.matchAll(/\.(insert|delete)\(\s*marketplaceLibraries\s*\)/g)) {
        sites.push({ kind: m[1], columns: null, readable: true });
    }

    // The seeder's bulk path, and the obvious way around an `.insert()` rule.
    for (const _m of code.matchAll(/\bbatchInsert\s*\(\s*[^,()]+,\s*marketplaceLibraries\s*,/g)) {
        void _m;
        sites.push({ kind: 'batchInsert', columns: null, readable: true });
    }

    // update: the columns decide, so the payload has to be read rather than
    // guessed at from a fixed window of characters after the call.
    for (const m of code.matchAll(/\.update\(\s*marketplaceLibraries\s*\)/g)) {
        const setAt = code.indexOf('.set(', m.index);
        const open = setAt === -1 ? -1 : setAt + '.set'.length;
        const payload = open === -1 ? null : balanced(code, open);
        const columns = payload === null ? null : setColumns(payload);
        if (columns === null) {
            sites.push({ kind: 'update', columns: null, readable: false });
            continue;
        }
        sites.push({ kind: 'update', columns, readable: true });
    }

    return sites;
}

/** Does this site write something that says what a pack IS? */
function writesContent(site) {
    if (site.kind !== 'update') return true;
    if (site.columns === null) return true;
    return site.columns.some((c) => !NON_CONTENT_COLUMNS.has(c));
}

// ---------------------------------------------------------------------------

function walk(dir, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules') continue;
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) walk(abs, out);
        else if (/\.tsx?$/.test(name) && !/\.(test|spec)\.tsx?$/.test(name)) out.push(abs);
    }
    return out;
}

// ---------------------------------------------------------------------------
// The scanner's own control, on every ordinary run
// ---------------------------------------------------------------------------
//
// The seeder control below proves the gate can see a `batchInsert`. It cannot
// prove the gate can read an `.set()` payload, which is where this instrument
// actually went blind — so the payload reader is scored here against the exact
// shapes the repository writes, shorthand first.

const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const SCANNER_FIXTURES = [
    // The case that was blind: shorthand and colon form in one payload.
    [() => setColumns('{ delistedAt, updatedAt: now }'), ['delistedAt', 'updatedAt']],
    // All shorthand, and all of it content. This one read as ZERO columns.
    [() => setColumns('{ semver, schema, kind }'), ['semver', 'schema', 'kind']],
    // The payload this gate reads most often. Its template literal carries
    // braces and a `.` path, and neither may end the object.
    [
        () => setColumns('{ downloadCount: sql`${marketplaceLibraries.downloadCount} + 1`, updatedAt: now }'),
        ['downloadCount', 'updatedAt'],
    ],
    // A nested object value must not have its own commas read as properties.
    [() => setColumns('{ metadata: { a: 1, b: 2 }, semver }'), ['metadata', 'semver']],
    // A spread hides its keys, so the payload is unreadable, not partial.
    [() => setColumns('{ ...patch, updatedAt: now }'), null],
    // So does a variable standing in for the whole payload.
    [() => setColumns('payload'), null],
    [() => setColumns('{}'), []],
];

let scannerFailures = 0;
SCANNER_FIXTURES.forEach(([run, want], n) => {
    let got;
    try {
        got = run();
    } catch (err) {
        got = `threw ${err.message}`;
    }
    if (!eq(got, want)) {
        scannerFailures += 1;
        console.log(`  ✘ payload-reader self-check ${n + 1}: got ${JSON.stringify(got)}, `
            + `expected ${JSON.stringify(want)}`);
    }
});

const failures = [];

if (!existsSync(SCAN_DIR)) {
    console.log(`catalogue-writes: ${relative(ROOT, SCAN_DIR)} does not exist, so this gate `
        + 'scanned nothing. Unreadable is a failure here, never a pass.');
    process.exit(1);
}
if (!existsSync(join(ROOT, SEEDER))) {
    console.log(`catalogue-writes: the declared seeder ${SEEDER} does not exist. A seeder that `
        + 'moved makes this gate blind to the one write it is meant to allow — and blind reads '
        + 'exactly like clean.');
    process.exit(1);
}

const files = walk(SCAN_DIR).map((abs) => relative(ROOT, abs).replace(/\\/g, '/'));
const touching = files.filter((rel) => new RegExp(`\\b${TABLE}\\b`).test(readFileSync(join(ROOT, rel), 'utf8')));

let contentWrites = 0;
let seederContentWrites = 0;
const offenders = new Map();

for (const rel of touching) {
    const sites = catalogueWrites(readFileSync(join(ROOT, rel), 'utf8'));
    for (const site of sites) {
        if (!site.readable) {
            failures.push(`  ✘ ${rel} updates ${TABLE} with a payload this gate could not read. `
                + 'Unreadable is a failure here: an unread payload looks exactly like a payload '
                + 'that writes nothing.');
            continue;
        }
        if (!writesContent(site)) continue;
        contentWrites += 1;
        if (rel === SEEDER) {
            seederContentWrites += 1;
            continue;
        }
        const where = offenders.get(rel) ?? [];
        where.push(site.kind === 'update' ? `update(${site.columns.join(', ')})` : site.kind);
        offenders.set(rel, where);
    }
}

// Both numbers on every run, including the zeroes.
console.log(`catalogue-writes: payload-reader self-check ${SCANNER_FIXTURES.length} case(s) / `
    + `${SCANNER_FIXTURES.length - scannerFailures} as expected.`);
console.log(`catalogue-writes: ${touching.length} of ${files.length} server file(s) name ${TABLE} · `
    + `${contentWrites} content write(s), ${seederContentWrites} of them in the seeder · `
    + `${offenders.size} file(s) outside it.`);

// A scan that found nothing to look at is a broken instrument, not a clean repo.
if (touching.length === 0) {
    console.log(`  ✘ no file under server/ names ${TABLE} at all, so this gate examined nothing. `
        + 'That is the reader having broken, not the catalogue being safe.');
    process.exit(1);
}

// The positive control. The seeder writes content by definition; if the matcher
// cannot see THAT, its silence about every other file is worth nothing.
if (seederContentWrites === 0) {
    failures.push(`  ✘ the matcher sees no content write in ${SEEDER}, the one file that certainly `
        + 'performs one. Its clean result over every other file therefore proves nothing — this is '
        + 'the control on the instrument, not a finding about the seeder.');
}

for (const [rel, kinds] of offenders) {
    failures.push(`  ✘ ${rel} writes catalogue content (${kinds.join('; ')}). Only ${SEEDER} may. `
        + 'The statutory import validator is relaxed on the strength of the catalogue being '
        + 'unreachable from user input, and this is that reach. A counter (downloadCount), the row '
        + 'mtime (updatedAt) and its visibility (delistedAt) are the only columns anything else '
        + 'may set.');
}

if (scannerFailures > 0) {
    failures.push('  ✘ the payload reader failed its own fixtures, so every "not a content write" '
        + 'verdict above was reached by an instrument that is known to be wrong. Fix the reader '
        + 'before reading anything into the scan.');
}

if (failures.length > 0) {
    for (const f of failures) console.log(f);
    process.exit(1);
}
process.exit(0);
