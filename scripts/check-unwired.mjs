#!/usr/bin/env node
/**
 * Unwired-capability census — modules the PRODUCT cannot reach.
 *
 * ## The blind spot this exists to close
 *
 * `lint:deadcode` runs knip against `knip.json`, whose `entry` list includes
 * `**\/*.test.*`, `**\/*.spec.*` and `tests/**`. That is correct for its own
 * question — it stops the gate demanding the deletion of every test helper —
 * but it means **a module imported by its own spec and by nothing else counts
 * as used.** A whole pipeline reachable only from its own tests is invisible
 * to it, and every suite stays green while the product cannot get there.
 *
 * That is not hypothetical. `server/lib/statutory/render.ts` renders a
 * statutory form onto the authority's own PDF; its only importer is
 * `tests/unit/statutory-forms/render.spec.ts`. Nothing in `server/api/` reaches
 * it. `lint:deadcode` reports it as used, because a test uses it. The execution
 * ledger records TEN separate instances of the same shape — a primitive built,
 * tested, and never connected — found each time by somebody reading code, not
 * by a gate.
 *
 * ## The question this asks instead
 *
 * Not "is anything importing this" but **"can the running product reach this"**.
 * Same tool, second config: `knip.production.json` is `knip.json` with the test
 * globs removed from `entry` AND from `project`, so the only roots are the
 * worker entry, the API, the routes and the scripts. What comes back unused is
 * what the product cannot reach.
 *
 * ## Why a baseline rather than a failure
 *
 * The first run found THIRTY files. A gate that fails on thirty is a gate
 * somebody switches off. So this is the same ratchet the tree already uses for
 * file size and tenant scoping: the census is frozen with a REASON per entry,
 * and a NEW unreachable file fails.
 *
 * ⚠️ A reason is mandatory and is checked for length. A baseline of bare paths
 * would record that thirty modules are unreachable and lose the only thing
 * worth knowing — which of them is a test double (fine), which is read by a
 * non-TypeScript gate (fine), and which is a capability that was built and
 * never connected (not fine, and the reason to have this at all).
 *
 * ⚠️ **Being in this baseline is not absolution.** `deferred` entries are work
 * somebody still owes. The summary prints their count separately for exactly
 * that reason — a census whose total never moves has stopped being a census.
 *
 * ## What this gate cannot do
 *
 * It cannot tell a capability nobody wired yet from one deliberately kept for a
 * caller that does not exist yet. Only the reason string distinguishes those,
 * and a person writes that. The gate checks a reason EXISTS; it cannot check
 * the reason is true.
 *
 *   node scripts/check-unwired.mjs            # gate
 *   node scripts/check-unwired.mjs --update   # re-take the census
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = join(ROOT, 'knip.production.json');
const BASELINE = join(ROOT, 'scripts', 'unwired-baseline.json');
const UPDATE = process.argv.includes('--update');

/** Long enough that "todo" and "n/a" do not pass for an explanation. */
const MIN_REASON_CHARS = 20;

/** The categories a census entry may carry. Anything else is refused, because
 *  a free-text kind is how "unwired" and "intentional" stop being countable. */
const KINDS = new Set([
    // Superseded on purpose and kept rather than deleted. The module says so
    // itself; this is a decision already taken, not work owed.
    'frozen',
    // A test double, fixture or dev-only implementation. Correct to be here.
    'test-only',
    // Read by a non-TypeScript tool — a gate script that parses the source as
    // text — so the module graph genuinely cannot see the consumer.
    'tool-consumed',
    // 🔴 A capability that was built and never connected to the product. This
    // is the count that matters; it is work owed, not an exemption granted.
    'deferred',
]);

function knipUnreachableFiles() {
    let out;
    try {
        out = execFileSync(
            process.execPath,
            [join(ROOT, 'node_modules', 'knip', 'bin', 'knip.js'), '--config', CONFIG, '--include', 'files'],
            { cwd: ROOT, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
        );
    } catch (err) {
        // knip exits non-zero when it has findings, which is the normal case
        // here. Its stdout is still the answer; only a missing stdout is a real
        // failure.
        out = err.stdout ?? '';
        if (!out) {
            console.error(`unwired: knip produced no output — ${err.message}`);
            process.exit(1);
        }
    }
    const files = [];
    let inSection = false;
    for (const raw of out.split(/\r?\n/)) {
        if (/^Unused files\b/.test(raw)) { inSection = true; continue; }
        if (inSection) {
            const line = raw.trim();
            // The section ends at the first blank line or the next heading.
            if (line === '' || /^[A-Z][a-z].*\(\d+\)\s*$/.test(line)) break;
            // Configuration/tag hints share the pane and carry a second column
            // naming the config file; a real finding is a bare path.
            if (/\s{2,}\S/.test(line)) continue;
            if (/^(app|server|workers|packages)\//.test(line)) files.push(line);
        }
    }
    return files.sort();
}

function loadBaseline() {
    if (!existsSync(BASELINE)) return {};
    return JSON.parse(readFileSync(BASELINE, 'utf8'));
}

function validateBaseline(baseline) {
    const problems = [];
    for (const [file, entry] of Object.entries(baseline)) {
        if (typeof entry !== 'object' || entry === null) {
            problems.push(`${file}: entry must be an object with { kind, reason }`);
            continue;
        }
        if (!KINDS.has(entry.kind)) {
            problems.push(`${file}: kind "${entry.kind}" is not one of ${[...KINDS].join(' | ')}`);
        }
        if (typeof entry.reason !== 'string' || entry.reason.trim().length < MIN_REASON_CHARS) {
            problems.push(
                `${file}: reason must be at least ${MIN_REASON_CHARS} characters saying WHY the ` +
                'product cannot reach it — a path with no reason records nothing worth knowing',
            );
        }
    }
    return problems;
}

const found = knipUnreachableFiles();

if (UPDATE) {
    const previous = loadBaseline();
    const next = {};
    for (const file of found) {
        next[file] = previous[file] ?? {
            kind: 'deferred',
            reason: 'CENSUS PLACEHOLDER — say why the product cannot reach this, and change kind if it is a test double or tool-consumed.',
        };
    }
    writeFileSync(BASELINE, `${JSON.stringify(next, null, 2)}\n`);
    const carried = found.filter((f) => previous[f]).length;
    console.log(
        `unwired: census re-taken — ${found.length} unreachable file(s), ` +
        `${carried} carried forward, ${found.length - carried} new placeholder(s) to explain`,
    );
    process.exit(0);
}

const baseline = loadBaseline();

// 🔴 Zero examined is an instrument failure, not a clean tree. A knip config
// that stopped resolving, or a parse that stopped matching, would otherwise
// report a perfect result on the day it went blind — which is the failure mode
// this repository keeps recording against its own gates.
if (found.length === 0) {
    console.error(
        'unwired: knip reported ZERO unreachable files.\n' +
        '  That is not a pass. Every entry point resolving and every module\n' +
        '  reachable would be a first; far more likely the config stopped\n' +
        '  matching or the output format changed. Check knip.production.json\n' +
        '  and this script\'s parser before believing it.',
    );
    process.exit(1);
}

const shapeProblems = validateBaseline(baseline);
const isNew = found.filter((f) => !baseline[f]);
const stale = Object.keys(baseline).filter((f) => !found.includes(f));
const deferred = found.filter((f) => baseline[f]?.kind === 'deferred');

// Both numbers, side by side, on every run — a gate that prints only its
// verdict cannot be checked on the day it is green.
console.log(
    `unwired: examined ${found.length} file(s) unreachable from production entries · ` +
    `${isNew.length} new · ${deferred.length} deferred (capability built, not connected) · ` +
    `${stale.length} baselined entry(ies) now reachable`,
);

if (stale.length) {
    console.log('  Now reachable — wired since the census was taken. Run --update to prune:');
    for (const f of stale) console.log(`    ✓ ${f}`);
}

if (shapeProblems.length) {
    console.error('\n  Baseline entries that do not say enough:');
    for (const p of shapeProblems) console.error(`    ✘ ${p}`);
}

if (isNew.length) {
    console.error(
        `\n✘ ${isNew.length} module(s) the product cannot reach, and the census does not explain:`,
    );
    for (const f of isNew) console.error(`    ✘ ${f}`);
    console.error(
        '\n  This is the shape that has been found ten times by hand: a capability\n' +
        '  built, tested, and never connected. Every one of its tests passes.\n' +
        '\n  Either wire it — an API route, a job, a component somebody renders —\n' +
        '  or add it to scripts/unwired-baseline.json with a kind and a reason:\n' +
        '\n    "server/lib/x.ts": { "kind": "deferred", "reason": "why the product cannot reach it yet" }\n' +
        '\n  `deferred` is not an exemption. It is a record that somebody owes this.',
    );
}

process.exit(isNew.length || shapeProblems.length ? 1 : 0);
