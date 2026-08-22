#!/usr/bin/env node
/**
 * Cron budget gate.
 *
 * The Workers Free CPU ceiling is 10 ms PER INVOCATION, and this repository
 * promises the free tier in README.md. That promise was broken for the
 * scheduled path for the whole life of the feature because nobody could see it:
 * the fetch path had the arithmetic written down (docs/develop/architecture.md)
 * and the scheduled path never did. The same asymmetry existed among the gates
 * — the free tier's 3 MiB SCRIPT limit has one (check-bundle-size.mjs) and its
 * CPU limit had none.
 *
 * CPU cannot be measured from source, so this gate gates the SHAPE that made
 * the overrun possible:
 *
 *   1. every declared job carries a probe, a run and a maxBatch;
 *   2. every declared job is actually registered — a job nobody lists runs
 *      never, which is the failure this whole refactor exists to remove;
 *   3. no job body is reachable from the dispatcher — the tick's budget pays
 *      for probes only;
 *   4. no unbounded table read survives in a scanned cron path, except the
 *      entries in ALLOWED_UNBOUNDED, each of which carries its reason.
 *
 * Every run prints what it CHECKED next to what it FOUND, pass or fail. A gate
 * that speaks only when it is angry cannot be audited on the day it is quiet,
 * and an empty job list would satisfy every per-job assertion below without
 * checking anything — so zero jobs is a failure, not a pass.
 *
 * Usage: node scripts/check-cron-budget.mjs
 */
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rel = (p) => relative(ROOT, p).replace(/\\/g, '/');

const REGISTRY = resolve(ROOT, 'server/cron/registry.ts');
const DISPATCH = resolve(ROOT, 'server/cron/dispatch.ts');
const JOBS_DIR = resolve(ROOT, 'server/cron/jobs');

/**
 * Files outside `server/cron/` whose reads are still part of a cron
 * invocation's own cost. Everything under `server/cron/` is discovered rather
 * than listed, so a new job module cannot be added outside this gate's view;
 * these two are the sweeps those modules delegate to.
 */
const EXTRA_READ_SCOPE = [
    'server/lib/media/sweep-orphans.ts',
    'server/lib/media/pending-attachments.ts',
];

/**
 * Unbounded reads that are allowed to stay, and why. A bare exemption list is
 * indistinguishable from an oversight, so the value here is the argument.
 */
const ALLOWED_UNBOUNDED = new Map([
    [
        'server/cron/jobs/daily.ts:tenants',
        'r2-usage reads the tenant id list to measure each tenant\'s storage. It is one '
        + 'narrow column, it runs on its own daily trigger with its own CPU budget, and a '
        + 'bound would silently stop measuring whichever tenants fell off the end — a '
        + 'partial storage figure that reads as a complete one.',
    ],
    [
        'server/lib/media/sweep-orphans.ts:inspectionMediaPool',
        'Scoped to ONE inspection (inspectionId + tenantId), inside a batch already capped '
        + 'at maxBatch inspections. Its size is one inspection\'s photo count, not the '
        + 'table\'s. A .limit() here would treat the photos past the limit as unreferenced '
        + 'and queue live media for deletion.',
    ],
    [
        'server/lib/media/sweep-orphans.ts:orphanedMedia',
        'Same shape and the same reason: one inspection\'s orphan-bookkeeping rows, inside '
        + 'an already-capped batch. Truncating it would re-record keys it had already seen '
        + 'and reset their grace window every pass, so nothing would ever be reaped.',
    ],
]);

const errors = [];
const notes = [];

// ── Instrument self-check ────────────────────────────────────────────────────
// Validate the reader before trusting anything it says. Every check below is
// vacuously satisfiable by a file that failed to load.
for (const f of [REGISTRY, DISPATCH]) {
    if (!existsSync(f)) {
        console.error(`cron budget: cannot read ${rel(f)} — the gate is broken, not the repo.`);
        process.exit(1);
    }
}
if (!existsSync(JOBS_DIR)) {
    console.error(`cron budget: ${rel(JOBS_DIR)} does not exist — the gate is broken, not the repo.`);
    process.exit(1);
}

const registrySrc = readFileSync(REGISTRY, 'utf8');
const dispatchSrc = readFileSync(DISPATCH, 'utf8');
const jobFiles = readdirSync(JOBS_DIR).filter((f) => f.endsWith('.ts')).map((f) => `server/cron/jobs/${f}`);

if (jobFiles.length === 0) {
    console.error(`cron budget: ${rel(JOBS_DIR)} holds no .ts files — the gate is broken, not the repo.`);
    process.exit(1);
}

// ── Checks 1 and 2: jobs are fully declared, and registered ──────────────────
//
// Job modules are read as text rather than imported, because this is a plain
// node script and the modules are TypeScript that pull in the whole server
// graph. Each job is `export const <name>: CronJob = { … }`, which is the shape
// this reads; a job written any other way is invisible here, so the totals
// below are printed for exactly that reason.
const JOB_CONST = /^export const ([A-Za-z0-9_]+): CronJob = \{/gm;
const REQUIRED_FIELDS = ['key:', 'label:', 'trigger:', 'modes:', 'probe:', 'run:', 'maxBatch:'];

const declared = [];
for (const relPath of jobFiles) {
    const src = readFileSync(resolve(ROOT, relPath), 'utf8');
    const hits = [...src.matchAll(JOB_CONST)];
    for (let i = 0; i < hits.length; i++) {
        const start = hits[i].index;
        const end = i + 1 < hits.length ? hits[i + 1].index : src.length;
        const block = src.slice(start, end);
        declared.push({
            name: hits[i][1],
            file: relPath,
            key: /key:\s*'([a-z0-9-]+)'/.exec(block)?.[1] ?? null,
            missing: REQUIRED_FIELDS.filter((f) => !block.includes(f)),
        });
    }
}

if (declared.length === 0) {
    console.error(
        `cron budget: parsed ZERO jobs from ${jobFiles.length} file(s) under ${rel(JOBS_DIR)}. `
        + 'Either no job is declared, or the `export const <name>: CronJob = {` shape this gate '
        + 'reads has changed. Both are failures — an empty job list satisfies every per-job '
        + 'check below.',
    );
    process.exit(1);
}

const incomplete = declared.filter((j) => j.missing.length > 0 || j.key === null);
if (incomplete.length) {
    errors.push(
        `${incomplete.length} of ${declared.length} cron job(s) are incompletely declared:\n`
        + incomplete.map((j) => `    ${j.file}:${j.name} — missing ${(j.key === null ? ['key:'] : []).concat(j.missing).join(', ')}`).join('\n')
        + '\n    A job with no maxBatch has no stated bound, and a job with no probe is '
        + 'enqueued on every tick whether or not it has work.',
    );
}

const registryList = /export const CRON_JOBS: CronJob\[\] = \[([\s\S]*?)\];/.exec(registrySrc)?.[1];
if (registryList === undefined) {
    errors.push(`${rel(REGISTRY)} has no readable CRON_JOBS list — the gate cannot check registration.`);
} else {
    const unregistered = declared.filter((j) => !new RegExp(`\\b${j.name}\\b`).test(registryList));
    if (unregistered.length) {
        errors.push(
            `${unregistered.length} of ${declared.length} declared job(s) appear in no CRON_JOBS entry:\n`
            + unregistered.map((j) => `    ${j.file}:${j.name} — add it to ${rel(REGISTRY)}, or delete it`).join('\n')
            + '\n    A job nobody lists never runs, and nothing anywhere would say so.',
        );
    }
}

// ── Check 3: the dispatcher runs no job body ─────────────────────────────────
//
// This is the invariant the whole free-tier fix rests on: thirteen jobs cannot
// share one 10 ms budget, so the tick must spend its budget on probes only.
const RUN_CALL = /\bjob\.run\s*\(|\.run\s*\(\s*env/g;
const dispatchRunCalls = [...dispatchSrc.matchAll(RUN_CALL)];
if (dispatchRunCalls.length > 0) {
    errors.push(
        `${rel(DISPATCH)} calls a job body ${dispatchRunCalls.length} time(s). The cron `
        + "invocation's CPU budget pays for probes only; job bodies belong on the queue, where "
        + 'each gets its own invocation and its own budget.',
    );
}
if (!dispatchSrc.includes('.probe(')) {
    errors.push(
        `${rel(DISPATCH)} never calls probe(). A dispatcher that probes nothing enqueues `
        + 'nothing, and would pass the check above by doing no work at all.',
    );
}

// ── Check 4: no unbounded table read in a scanned cron path ──────────────────
//
// `.all()` with no `.limit(` in the same statement is a read whose cost is the
// size of the table — the exact shape that put the old handler 13.8x over the
// ceiling, and one that grows silently long after it ships.
const readScope = [
    'server/cron/registry.ts',
    'server/cron/dispatch.ts',
    'server/cron/consumer.ts',
    'server/cron/cursor.ts',
    'server/cron/types.ts',
    ...jobFiles,
    ...EXTRA_READ_SCOPE,
];

let readsChecked = 0;
let filesScanned = 0;
const skippedFiles = [];
const unbounded = [];
const allowedHits = [];

for (const relPath of readScope) {
    const abs = resolve(ROOT, relPath);
    if (!existsSync(abs)) {
        // Printed, always. A file that quietly leaves the scope takes its reads
        // with it, and the totals below would still look healthy.
        skippedFiles.push(relPath);
        continue;
    }
    filesScanned++;
    const src = readFileSync(abs, 'utf8');
    let idx = src.indexOf('.all()');
    while (idx !== -1) {
        readsChecked++;
        // Walk back to the start of the statement. `;`, `{` and `=>` are the
        // three boundaries a drizzle chain can begin after in this codebase.
        const boundaries = [src.lastIndexOf(';', idx), src.lastIndexOf('{', idx), src.lastIndexOf('=>', idx)];
        const start = Math.max(...boundaries) + 1;
        const stmt = src.slice(start, idx);
        if (!stmt.includes('.limit(')) {
            const table = /\.from\(([A-Za-z0-9_]+)\)/.exec(stmt)?.[1] ?? 'unknown';
            const id = `${relPath}:${table}`;
            const line = src.slice(0, idx).split('\n').length;
            if (ALLOWED_UNBOUNDED.has(id)) allowedHits.push(`${id} (line ${line})`);
            else unbounded.push(`${id} (line ${line}) — add a .limit(), or an ALLOWED_UNBOUNDED entry with the reason`);
        }
        idx = src.indexOf('.all()', idx + 1);
    }
}

if (readsChecked === 0) {
    errors.push(
        `check 4 examined ZERO reads across ${filesScanned} file(s). Either every cron read has `
        + 'stopped using .all(), or this scan no longer finds them. Zero examined is a broken '
        + 'instrument, not a clean tree.',
    );
}
if (unbounded.length) {
    errors.push(
        `${unbounded.length} of ${readsChecked} read(s) in the cron path are unbounded:\n`
        + unbounded.map((s) => `    ${s}`).join('\n'),
    );
}

// An exemption that no longer matches anything is a reason nobody can evaluate,
// and it silently inflates the arithmetic printed below.
const staleAllowances = [...ALLOWED_UNBOUNDED.keys()].filter(
    (k) => !allowedHits.some((h) => h.startsWith(`${k} `)),
);
if (staleAllowances.length) {
    errors.push(
        `${staleAllowances.length} ALLOWED_UNBOUNDED entr(ies) match nothing any more:\n`
        + staleAllowances.map((s) => `    ${s} — delete it`).join('\n'),
    );
}

for (const s of skippedFiles) notes.push(`skipped (not found): ${s}`);
for (const s of allowedHits) notes.push(`allowed unbounded: ${s}`);

// ── Report ───────────────────────────────────────────────────────────────────
const summary =
    `cron budget: ${declared.length} job(s) declared in ${jobFiles.length} module(s) · `
    + `${declared.length - incomplete.length} fully declared · `
    + `${filesScanned}/${readScope.length} file(s) scanned · ${readsChecked} read(s) examined · `
    + `${unbounded.length} unbounded · ${allowedHits.length} allowed · ${skippedFiles.length} file(s) skipped`;

for (const n of notes) console.log(`  · ${n}`);

if (errors.length) {
    for (const e of errors) console.error(`  ✘ ${e}`);
    console.error(`\n${summary} — FAIL`);
    process.exit(1);
}

console.log(`${summary} — OK`);
