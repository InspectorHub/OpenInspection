#!/usr/bin/env node
/**
 * Bundled-content version gate.
 *
 * `STARTER_CONTENT_VERSION` decides whether an existing workspace is offered
 * the content this release ships: the sweep job compares it against
 * `tenants.content_version` and skips every workspace that already matches. So
 * changing a fixture WITHOUT bumping the constant ships the change to new
 * workspaces only, silently, forever — which is the exact failure the sweep was
 * built to remove, reintroduced one level up.
 *
 * Nothing about that is visible in a diff: the fixture edit looks complete on
 * its own. This gate is the executable form of the "keep these in sync"
 * comment the repository's Comment Rules say not to write in prose.
 *
 * ── What it compares ────────────────────────────────────────────────────────
 * A sha256 over every file the seeder ships, against the hash recorded for the
 * current constant in `content-version-baseline.json`. Three outcomes:
 *
 *   - hash matches the record          → pass, nothing changed
 *   - constant is not in the record    → the constant was bumped; run --update
 *   - hash moved, constant did not     → FAIL, and name the files that moved
 *
 * ── It checks its own instrument first ──────────────────────────────────────
 * A gate that hashes a file list can only report "unchanged" if the list is
 * non-empty and every entry resolves. An empty or stale list hashes to a
 * perfectly stable value and passes forever while checking nothing, so a
 * missing file and a zero-length list are both failures here, not passes.
 *
 * Usage: node scripts/check-content-version.mjs [--update]
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

const CONSTANT_FILE = resolve(ROOT, 'server/services/starter-content/content-version.ts');
const BASELINE_FILE = resolve(ROOT, 'scripts/content-version-baseline.json');

/**
 * The inputs the seeders turn into rows. Two are directories rather than named
 * files so that ADDING a fixture is covered without editing this gate — the
 * failure mode of a hand-listed set is that the one new file nobody remembered
 * is the one that silently ships to nobody.
 *
 * ⚠️ This is deliberately WIDER than the set actually seeded, and not by
 * accident: measured 2026-09-01, `server/data/seed-templates/` holds 20 JSON
 * files of which 11 are imported (7 by the starter-content service, 4 by the
 * marketplace packs). Editing one of the other 9 will fail this gate and force
 * a version bump that ships nothing.
 *
 * That is the direction to be wrong in. A false positive costs one sweep that
 * inserts no rows; a false negative is a fixture that reaches new workspaces
 * only, which is the failure the sweep exists to remove. Deriving the exact set
 * by parsing import statements would also lose the property that matters most
 * here — covering a file that is added to the directory now and wired up later.
 */
const CONTENT_SOURCES = [
    { kind: 'dir', path: 'server/services/starter-content/fixtures', ext: '.ts' },
    { kind: 'dir', path: 'server/data/seed-templates', ext: '.json' },
    { kind: 'file', path: 'server/lib/people/default-role-profiles.ts' },
];

function collect() {
    const files = [];
    const missing = [];
    for (const src of CONTENT_SOURCES) {
        const abs = resolve(ROOT, src.path);
        if (!existsSync(abs)) { missing.push(src.path); continue; }
        if (src.kind === 'file') { files.push(abs); continue; }
        const found = readdirSync(abs)
            .filter((n) => n.endsWith(src.ext))
            .map((n) => resolve(abs, n));
        // A directory that resolves but holds nothing is the stale-list failure
        // this gate is supposed to be immune to. Treat it as missing.
        if (found.length === 0) missing.push(`${src.path}/*${src.ext} (directory is empty)`);
        files.push(...found);
    }
    return { files: files.sort(), missing };
}

/** Per-file digests, so a failure can name what moved rather than only that something did. */
function digest(files) {
    const per = new Map();
    const all = createHash('sha256');
    for (const f of files) {
        // Line endings are NORMALISED before hashing, and that is a correction
        // rather than the original intent. This first hashed raw bytes, on the
        // reasoning that normalising would hide a fixture whose line endings
        // changed. CI disagreed within the hour: this repository's working
        // trees are not uniform about eol, so a file checked out as LF on the
        // runner and sitting as CRLF on a developer's disk hashed to two
        // different values, and the baseline recorded from one machine failed
        // on the other.
        //
        // Normalising is also simply the right question to ask. What this gate
        // exists to detect is a change in the CONTENT the seeders ship, and a
        // line ending is not one: every row inserted from a fixture is
        // identical either way. A fixture that changed anything a workspace
        // would receive still moves this hash.
        const text = readFileSync(f, 'utf8').replace(/\r\n/g, '\n');
        const h = createHash('sha256').update(text, 'utf8').digest('hex');
        per.set(rel(f), h);
        all.update(rel(f)).update('\0').update(h).update('\0');
    }
    return { combined: all.digest('hex'), per };
}

function readConstant() {
    if (!existsSync(CONSTANT_FILE)) return null;
    const m = /export const STARTER_CONTENT_VERSION = '([^']+)'/.exec(readFileSync(CONSTANT_FILE, 'utf8'));
    return m ? m[1] : null;
}

// `run-gates.mjs` IMPORTS each gate rather than spawning it, so `process.argv`
// belongs to that run, not to this file. Recording a new baseline is a write,
// and must never be reachable from a flag someone passed to the aggregate
// runner — a gate that can quietly rewrite its own expectation is not a gate.
const invokedDirectly = process.argv[1]
    && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
const update = Boolean(invokedDirectly) && process.argv.includes('--update');
const { files, missing } = collect();
const version = readConstant();
const { combined, per } = digest(files);

console.log('[content-version] checked '
    + `${CONTENT_SOURCES.length} source(s) -> ${files.length} file(s) hashed, `
    + `${missing.length} unresolved; constant = ${version ?? '(not found)'}`);

const fail = (msg) => { console.error(`[content-version] FAIL — ${msg}`); process.exit(1); };

// ── the instrument, before the measurement ─────────────────────────────────
if (missing.length > 0) fail(`content source(s) did not resolve: ${missing.join(', ')}`);
if (files.length === 0) fail('hashed zero files — the source list cannot verify anything');
if (!version) fail(`no STARTER_CONTENT_VERSION found in ${rel(CONSTANT_FILE)}`);

const baseline = existsSync(BASELINE_FILE)
    ? JSON.parse(readFileSync(BASELINE_FILE, 'utf8'))
    : { versions: {} };

if (update) {
    baseline.versions[version] = { combined, files: Object.fromEntries(per) };
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
    console.log(`[content-version] recorded ${version} = ${combined.slice(0, 12)}… `
        + `over ${files.length} file(s) -> ${rel(BASELINE_FILE)}`);
    process.exit(0);
}

const recorded = baseline.versions[version];
if (!recorded) {
    fail(`STARTER_CONTENT_VERSION is '${version}', which has no recorded hash. `
        + 'If you bumped it deliberately, record the content it names:\n'
        + '    npm run lint:content-version -- --update');
}

if (recorded.combined === combined) {
    console.log(`[content-version] OK — ${files.length} file(s) match the hash recorded for ${version}.`);
    process.exit(0);
}

const moved = [];
for (const [f, h] of per) if (recorded.files?.[f] !== h) moved.push(f);
for (const f of Object.keys(recorded.files ?? {})) if (!per.has(f)) moved.push(`${f} (removed)`);

console.error(`[content-version] FAIL — bundled content changed but STARTER_CONTENT_VERSION is still '${version}'.`);
console.error(`  recorded ${recorded.combined.slice(0, 12)}…  now ${combined.slice(0, 12)}…`);
console.error(`  ${moved.length} file(s) moved:`);
for (const f of moved) console.error(`    ${f}`);
console.error('\n  Existing workspaces are given content only when this constant changes.');
console.error('  Bump it in server/services/starter-content/content-version.ts, then:');
console.error('      npm run lint:content-version -- --update');
process.exit(1);
