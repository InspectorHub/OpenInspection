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
 * ── Content vs counter ──────────────────────────────────────────────────────
 * `downloadCount` is the tenants' own history and `updatedAt` records when a row
 * moved; neither says what a pack IS. Every other column does, so the rule is
 * stated as an allow-list of the two — a deny-list would silently admit the next
 * column somebody adds, which is precisely the column a new capability arrives
 * with.
 *
 * ── Why the seeder is a positive control, not just an exemption ─────────────
 * A matcher that has stopped recognising a write reports a clean scan, and a
 * clean scan is what this gate prints when everything is fine. So the seeder's
 * OWN write has to be visible to the same matcher: if the gate cannot see the
 * one write it knows exists, a clean result over everything else means nothing.
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

/** Columns that are NOT content: a counter, and the row's own mtime. */
const NON_CONTENT_COLUMNS = new Set(['downloadCount', 'updatedAt']);

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
        if (payload === null) {
            sites.push({ kind: 'update', columns: null, readable: false });
            continue;
        }
        const columns = [...new Set(
            [...payload.matchAll(/(^|[{,\s])([A-Za-z_$][\w$]*)\s*:/g)].map((c) => c[2]),
        )];
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
        + 'unreachable from user input, and this is that reach. A counter (downloadCount) and the '
        + 'row mtime (updatedAt) are the only columns anything else may set.');
}

if (failures.length > 0) {
    for (const f of failures) console.log(f);
    process.exit(1);
}
process.exit(0);
