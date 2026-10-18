#!/usr/bin/env node
/**
 * Loader budget: a route loader must not do avoidable work before first paint.
 *
 * Scans the exported `loader` / `clientLoader` of every non-test file under app/routes
 * (TypeScript AST, not regex) and reports, per file, the shapes listed in
 * scripts/lib/loader-budget-detect.mjs: a Promise.all wider than six, an API call
 * per item in a map or loop, two adjacent awaits that could run together (also when
 * the call is hidden behind a helper that is handed the client), and a hand-built
 * Response.
 *
 * Existing violations are frozen in scripts/loader-budget-baseline.json ({ path: count });
 * a file may only get better. An intentional exception is
 * `// loader-budget-allow: <reason>` above the statement; the reason is mandatory.
 *
 * Prints BOTH numbers on every run (loaders scanned, violations found), and fails when it
 * scanned nothing, when its file listing disagrees with an independent count, or when a rule
 * misses its own planted control (an empty result must not read as a clean one).
 *
 * Rung: PUSH. It parses ~150 route files, which is more than a commit should pay, and
 * the violations that matter are the sum over a branch rather than one keystroke.
 *
 * Usage: node scripts/check-loader-budget.mjs [--write-baseline]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectLoaderBudget } from './lib/loader-budget-detect.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = 'scripts/loader-budget-baseline.json';
const TAG = '[loader-budget]';

/** One planted violation per rule: each must make ITS rule fire. */
export const CONTROLS = [
    { rule: 'fanout', src: 'export async function loader() { const r = await Promise.all([a(), b(), c(), d(), e(), f(), g()]); return r; }' },
    { rule: 'call-in-loop', src: 'export async function loader() { const api = createApi(); return Promise.all(ids.map((id) => api.x.$get({ param: { id } }))); }' },
    { rule: 'serial-independent', src: 'export async function loader() { const api = createApi(); const a = await api.a.$get(); const b = await api.b.$get(); return [a, b]; }' },
    { rule: 'helper-serial', src: 'export async function loader() { const api = createApi(); const a = await loadA(api); const b = await loadB(api); return [a, b]; }' },
    { rule: 'helper-in-loop', src: 'export async function loader() { const api = createApi(); return Promise.all(ids.map((id) => loadOne(api, id))); }' },
    { rule: 'hand-built-response', src: 'export async function loader() { return new Response(JSON.stringify({ ok: true })); }' },
    { rule: 'allow-without-reason', src: ['export async function loader() {', '  const api = createApi();', '  const a = await api.a.$get();', '  // loader-budget-allow:', '  const b = await api.b.$get();', '  return [a, b];', '}'].join(String.fromCharCode(10)) },
];

const isTest = (p) => /\.(?:test|spec)\.tsx?$/.test(p) || p.includes('/__tests__/') || p.includes('/node_modules/');
const lsFiles = (...specs) => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs], {
    cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter((p) => p !== '');

export function missedControls(detect = detectLoaderBudget, controls = CONTROLS) {
    return controls.filter((c) => !detect(c.src, 'control.tsx').violations.some((v) => v.rule === c.rule)).map((c) => c.rule);
}

function main() {
    const present = (p) => existsSync(join(ROOT, p));
    const files = [...new Set(lsFiles(':(glob)app/routes/**/*.ts', ':(glob)app/routes/**/*.tsx'))].filter((p) => !isTest(p) && present(p)).sort();
    const counted = [...new Set(lsFiles('app/routes').filter((p) => /\.tsx?$/.test(p) && !isTest(p) && present(p)))];
    const baseline = existsSync(join(ROOT, BASELINE)) ? JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) : {};

    let sites = 0;
    let unreadable = 0;
    const found = new Map();
    for (const path of files) {
        let src;
        try { src = readFileSync(join(ROOT, path), 'utf8'); } catch { unreadable += 1; continue; }
        const r = detectLoaderBudget(src, path);
        sites += r.sites;
        if (r.violations.length) found.set(path, r.violations);
    }
    const total = [...found.values()].reduce((n, v) => n + v.length, 0);

    if (process.argv.includes('--write-baseline')) {
        const next = Object.fromEntries([...found].map(([p, v]) => [p, v.length]).sort(([a], [b]) => (a < b ? -1 : 1)));
        writeFileSync(join(ROOT, BASELINE), `${JSON.stringify(next, null, 2)}\n`);
        console.log(`${TAG} baseline written: ${Object.keys(next).length} file(s), ${total} violation(s)`);
        return;
    }

    const fresh = [];
    for (const [p, v] of found) if (v.length > (baseline[p] ?? 0)) fresh.push(p);
    // A baseline entry that no longer matches reality should shrink or go, or the ratchet slackens.
    const slack = Object.keys(baseline).filter((p) => (found.get(p)?.length ?? 0) < baseline[p]);

    console.log(`\n${TAG} ${files.length} file(s) scanned (${counted.length} by independent count) | ${sites} loader(s) | `
        + `${total} violation(s) | ${Object.keys(baseline).length} baselined file(s) | ${fresh.length} over baseline | ${slack.length} below baseline | ${unreadable} unreadable`);

    let failed = false;
    if (files.length === 0 || sites === 0) { console.error(`${TAG} scanned ZERO ${files.length === 0 ? 'files' : 'loaders'}. A scan of nothing is not a clean scan.`); failed = true; }
    if (files.length !== counted.length) { console.error(`${TAG} file listing disagrees with the independent count (${files.length} vs ${counted.length}).`); failed = true; }
    if (unreadable > 0) { console.error(`${TAG} ${unreadable} file(s) could not be read.`); failed = true; }
    const missed = missedControls();
    if (missed.length > 0) { console.error(`${TAG} BROKEN: the detector missed its own planted violation for rule(s): ${missed.join(', ')}.`); failed = true; }
    if (fresh.length) {
        console.error(`\n${fresh.length} file(s) over baseline:\n`);
        for (const p of fresh) for (const v of found.get(p)) console.error(`   ${p}:${v.line}  [${v.rule}] ${v.message}`);
        console.error('\nFix the loader, or, if the shape is intentional, write `// loader-budget-allow: <reason>` above the statement.');
        console.error('Do not raise the baseline. Lower it with: node scripts/check-loader-budget.mjs --write-baseline\n');
        failed = true;
    }
    if (slack.length) {
        console.error(`\n${slack.length} baselined file(s) now have fewer violations than recorded: ${slack.join(', ')}`);
        console.error('Ratchet it down: node scripts/check-loader-budget.mjs --write-baseline\n');
        failed = true;
    }
    if (failed) process.exit(1);
    console.log(`${TAG} OK\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) main();
