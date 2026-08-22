#!/usr/bin/env node
/**
 * E2E spec-coverage gate — the reverse direction of `check-test-layout.mjs`.
 *
 * `lint:tests` asserts that every literal `testMatch` in playwright.config.ts
 * resolves to a file. That is one-directional: it catches a project pointing at
 * a spec that does not exist, and says nothing about a spec that exists and is
 * pointed at by nothing. A spec nobody collects never runs, and a spec that
 * never runs is indistinguishable from a spec that passes.
 *
 * WHY THIS ASKS PLAYWRIGHT INSTEAD OF READING THE CONFIGS.
 * `testMatch` is a string, a RegExp, or an array of either, evaluated against a
 * path Playwright itself resolves, under a `testDir` and a `testIgnore`, per
 * project, sometimes behind a `process.env` ternary. A hand-rolled interpreter
 * would disagree with the runner exactly where the disagreement matters. So the
 * gate runs `playwright test --config=<cfg> --list --reporter=json` once per
 * config. `--list` collects and prints; it starts no browser, no `webServer`
 * and no `globalSetup`. Measured at ~3.4s per config on this machine.
 *
 * WHY A SWEEP CONFIG CANNOT CONFER OWNERSHIP — the finding that makes this gate
 * non-vacuous. `playwright.remote.config.ts` is a testDir-wide runner: it has no
 * `projects`, so it collects EVERY `*.spec.ts` under tests/e2e that its
 * `testIgnore` does not drop. Under a naive "collected by at least one config"
 * rule it answers yes for every spec that could ever be written there, and the
 * gate could never fail. It also runs against an already-deployed instance and
 * is not what `npm run test:e2e` or CI executes, so "the remote sweep collects
 * it" is not the same claim as "it runs".
 *
 * So ownership is decided by measurement rather than by a hardcoded allowlist:
 * the gate writes ONE throwaway probe spec into tests/e2e, registered nowhere,
 * and lists every config with it present. Any config that collects the probe is
 * a sweep — it would collect any unregistered spec, so its testimony is
 * worthless — and only the configs that do NOT collect the probe can own a
 * file. That calibration re-derives itself on every run, so a fifth config
 * added later is classified by measurement instead of by memory.
 *
 * Prints, every run: the configs it consulted, the env switches it set, the
 * number of specs on disk and the number owned, and the NAME of every orphan.
 *
 * Usage: node scripts/check-e2e-spec-coverage.mjs
 */
import { readdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SPEC_DIR = 'tests/e2e';
const SPEC_RE = /\.spec\.tsx?$/;

/**
 * The calibration probe. A spec file with an ordinary name that no config
 * mentions, written for the duration of the run and removed in a `finally`.
 * It is what turns "which configs are sweeps" from a maintained list into a
 * measurement.
 */
const PROBE_BASENAME = 'zz-e2e-coverage-probe.spec.ts';
const PROBE_REL = `${SPEC_DIR}/${PROBE_BASENAME}`;
const PROBE_SOURCE = `import { test } from '@playwright/test';

// Written and deleted by scripts/check-e2e-spec-coverage.mjs while it runs.
// If you are reading this in a committed file, that gate was interrupted:
// delete it. It is registered in no config on purpose.
test.skip('e2e coverage probe', () => {});
`;

/**
 * Env vars the configs branch on. A project behind `process.env.X ? a : b`
 * collects its spec only on one side of the ternary, so listing with them unset
 * would report those specs as orphans — `cloud-e2e.spec.ts` (CLOUD_BASE_URL)
 * and `public-timezone-hydration-cost.spec.ts` (TZ_PERF) are both in that
 * shape today. The names are read OUT OF the configs rather than typed here, so
 * a new switch is picked up on its own; the values are placeholders because
 * only truthiness decides collection.
 *
 * `CI` is excluded deliberately: it is supplied by the runner, not by the
 * suite, and setting it changes `forbidOnly`/`retries` rather than which files
 * are collected.
 */
const ENV_PLACEHOLDER = 'https://e2e-coverage-gate.invalid';
const ENV_NEVER_SET = new Set(['CI']);

const fail = (msg) => {
    console.error(msg);
    process.exit(1);
};

// ---- 1. specs on disk -----------------------------------------------------
const walk = (relDir) => {
    const out = [];
    const abs = path.join(ROOT, relDir);
    if (!existsSync(abs)) return out;
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
        const rel = `${relDir}/${entry.name}`;
        if (entry.isDirectory()) out.push(...walk(rel));
        else if (SPEC_RE.test(entry.name)) out.push(rel);
    }
    return out;
};
const specsOnDisk = walk(SPEC_DIR).sort();

// Zero specs is a broken instrument, not a clean tree. A walk that found
// nothing would go green forever and say nothing about why.
if (specsOnDisk.length === 0)
    fail(`e2e spec coverage: found ZERO spec files under ${SPEC_DIR}/ — the walk is broken, or the directory moved. Refusing to report OK.`);

// ---- 2. configs on disk ---------------------------------------------------
const configs = readdirSync(ROOT)
    .filter((f) => /^playwright(\..+)?\.config\.ts$/.test(f))
    .sort();
if (configs.length === 0)
    fail('e2e spec coverage: found ZERO playwright*.config.ts at the repo root — the discovery is broken. Refusing to report OK.');

// ---- 3. which npm script runs each config ---------------------------------
const npmScripts = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts ?? {};
const runnersFor = new Map(configs.map((c) => [c, []]));
for (const [name, body] of Object.entries(npmScripts)) {
    if (!/\bplaywright test\b/.test(body)) continue;
    const m = body.match(/(?:--config[= ]|-c )([^\s]+)/);
    const target = m ? path.basename(m[1]) : 'playwright.config.ts';
    if (runnersFor.has(target)) runnersFor.get(target).push(`npm run ${name}`);
}

// ---- 4. env switches the configs branch on --------------------------------
const envSwitches = new Set();
for (const c of configs) {
    const src = readFileSync(path.join(ROOT, c), 'utf8');
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        if (ENV_NEVER_SET.has(m[1])) continue;
        if (process.env[m[1]] !== undefined) continue; // a real value beats a placeholder
        envSwitches.add(m[1]);
    }
}
const listEnv = { ...process.env };
for (const name of envSwitches) listEnv[name] = ENV_PLACEHOLDER;

// ---- 5. list every config with the probe in place -------------------------
// Spawned as a node script rather than through `npx`, which resolves over the
// network on a cold cache and would make an offline rung fail for a reason that
// has nothing to do with the specs.
const PW_CLI = path.join(ROOT, 'node_modules', '@playwright', 'test', 'cli.js');
if (!existsSync(PW_CLI))
    fail(`e2e spec coverage: ${path.relative(ROOT, PW_CLI)} is missing, so no config can be listed. Run npm install. Refusing to report OK.`);

const listConfig = (cfg) => {
    const res = spawnSync(
        process.execPath,
        [PW_CLI, 'test', `--config=${cfg}`, '--list', '--reporter=json'],
        { cwd: ROOT, encoding: 'utf8', env: listEnv, maxBuffer: 64 * 1024 * 1024 },
    );
    const stdout = res.stdout ?? '';
    const start = stdout.indexOf('{');
    if (start === -1)
        return { error: `playwright could not list it (exit ${res.status}): ${(res.stderr || stdout || '').trim().slice(0, 800)}` };
    let report;
    try {
        report = JSON.parse(stdout.slice(start));
    } catch (err) {
        return { error: `its --list JSON did not parse: ${err.message}` };
    }
    const rootDir = report.config?.rootDir;
    if (!rootDir) return { error: 'its --list JSON carried no config.rootDir, so collected paths cannot be resolved' };
    const files = new Set();
    const walkSuite = (suite) => {
        for (const child of suite.suites ?? []) walkSuite(child);
        for (const spec of suite.specs ?? []) files.add(spec.file);
    };
    walkSuite({ suites: report.suites ?? [] });
    const rel = new Set();
    for (const f of files) rel.add(path.relative(ROOT, path.resolve(rootDir, f)).split(path.sep).join('/'));
    return { collected: rel };
};

if (existsSync(path.join(ROOT, PROBE_REL)))
    fail(`e2e spec coverage: ${PROBE_REL} already exists. That is this gate's throwaway probe, left behind by an interrupted run — delete it and re-run.`);

const results = new Map();
const started = Date.now();
try {
    writeFileSync(path.join(ROOT, PROBE_REL), PROBE_SOURCE, 'utf8');
    if (!existsSync(path.join(ROOT, PROBE_REL)))
        fail('e2e spec coverage: the calibration probe could not be written, so sweep detection cannot run. Refusing to report OK.');
    for (const cfg of configs) results.set(cfg, listConfig(cfg));
} finally {
    if (existsSync(path.join(ROOT, PROBE_REL))) unlinkSync(path.join(ROOT, PROBE_REL));
}
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

// A config this gate cannot list is not a config it may ignore: every spec that
// config owns would become a false orphan.
const unlistable = configs.filter((c) => results.get(c).error);
if (unlistable.length)
    fail(
        `e2e spec coverage: ${unlistable.length} of ${configs.length} config(s) could not be listed, so their specs cannot be accounted for:\n` +
        unlistable.map((c) => `    ${c} — ${results.get(c).error}`).join('\n'),
    );

// ---- 6. classify: a sweep cannot own --------------------------------------
const isSweep = (cfg) => results.get(cfg).collected.has(PROBE_REL);
const collectedSpecs = (cfg) =>
    [...results.get(cfg).collected].filter((f) => f !== PROBE_REL && SPEC_RE.test(f) && f.startsWith(`${SPEC_DIR}/`));

const owned = new Set();
for (const cfg of configs) {
    if (isSweep(cfg)) continue;
    for (const f of collectedSpecs(cfg)) owned.add(f);
}

// ---- 7. report — both numbers, every run ----------------------------------
console.log(`e2e spec coverage: consulted ${configs.length} playwright config(s) in ${elapsed}s —`);
for (const cfg of configs) {
    const mine = collectedSpecs(cfg);
    const runners = runnersFor.get(cfg);
    console.log(
        `    ${cfg.padEnd(34)} collects ${String(mine.length).padStart(3)} of ${specsOnDisk.length} ${SPEC_DIR} spec(s)` +
        ` · owns ${String(isSweep(cfg) ? 0 : mine.length).padStart(3)}` +
        ` · ${runners.length ? runners.join(', ') : 'NO npm script — run by hand'}` +
        (isSweep(cfg) ? ' · SWEEP (collects an unregistered spec, so it owns nothing)' : ''),
    );
}
console.log(
    `    env switches set for the listing (${envSwitches.size}): ` +
    (envSwitches.size ? [...envSwitches].sort().join(', ') : '(none)') +
    ` · never set: ${[...ENV_NEVER_SET].join(', ')}`,
);

// Every config a sweep means nothing can be owned and every spec would be
// reported as an orphan. That is the instrument failing, not the tree.
if (configs.every((c) => isSweep(c)))
    fail(
        `e2e spec coverage: ALL ${configs.length} config(s) collected the calibration probe, so none of them can testify to ownership. ` +
        'Either every config became a testDir-wide sweep or the probe leaked into one. Refusing to report OK.',
    );

const orphans = specsOnDisk.filter((f) => !owned.has(f));
console.log(
    `    ${specsOnDisk.length} spec file(s) on disk · ${owned.size} owned by a non-sweep config · ${orphans.length} orphan(s)`,
);

if (orphans.length) {
    console.error(
        `\ne2e spec coverage: ${orphans.length} spec file(s) are collected by NO config that can own them, so they never run:\n` +
        orphans.map((f) => `    ${f}`).join('\n') +
        '\n  Give each one a project in playwright.config.ts (or playwright.seeded.config.ts), or delete it.' +
        '\n  Collection by a SWEEP config alone does not count — see the header of this script.',
    );
    process.exit(1);
}

console.log('  ✓ every tests/e2e spec is collected by a config that enumerates it.');
