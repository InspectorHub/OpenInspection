/**
 * Shared runner for the JSX ratchet gates (busy-controls, hidden-focusable).
 *
 * Walks the ROOTS below (app/ and, where it exists, packages/shared-ui/src; *.tsx, tests excluded;
 * tracked and untracked-but-not-ignored files alike),
 * runs a detector per file, and compares violation
 * counts per file with a { path: count } baseline. It prints BOTH numbers -- sites looked
 * at and violations found -- so an empty result cannot read as green, and it fails when it
 * scanned nothing, when its file listing disagrees with an independent count, or when ANY of its
 * rules misses that rule's own planted control (one control per rule: a total count could be met by
 * the other rules while one stays broken). Baselines are expected to stay {}; the spec
 * tests/unit/tooling/jsx-gate-baselines.spec.ts fails if one gains a key.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Source roots, as directories. A root that does not exist in this repo simply lists nothing. */
const ROOTS = ['app', 'packages/shared-ui/src'];

const isTest = (p) => /\.(?:test|spec)\.tsx$/.test(p) || p.includes('/__tests__/') || p.includes('/node_modules/');
// Tracked AND untracked-but-not-ignored files: a new file is scanned from the moment it exists, not from
// the moment it is staged. (`git ls-files` alone listed only the index, so a violation in a file nobody had
// `git add`ed yet was invisible to a gate run before the commit.)
const lsFiles = (...specs) => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs], {
    cwd: ROOT,
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter((p) => p !== '');

/**
 * Rules whose planted control did not fire. Each control must make ITS rule report at least one violation.
 * @param {(src: string) => { violations: Array<{ rule: string }> }} detect
 * @param {Array<{ rule: string, src: string }>} controls
 * @returns {string[]} the rule ids that missed their control (empty when every rule fires)
 */
export function missedControls(detect, controls) {
    return controls.filter((c) => !detect(c.src).violations.some((v) => v.rule === c.rule)).map((c) => c.rule);
}

/**
 * @param {{ name: string, baselineFile: string, detect: (src: string) => { sites: number, violations: Array<{line:number, rule:string, message:string}> },
 *           controls: Array<{ rule: string, src: string }>, fixHint: string[] }} cfg
 */
export function runJsxGate(cfg) {
    const tag = `[${cfg.name}]`;
    const files = [...new Set(lsFiles(...ROOTS.map((r) => `:(glob)${r}/**/*.tsx`)))].filter((p) => !isTest(p)).sort();
    const counted = lsFiles(...ROOTS).filter((p) => p.endsWith('.tsx') && !isTest(p));
    const baselinePath = join(ROOT, cfg.baselineFile);
    const baseline = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, 'utf8')) : {};

    let sites = 0;
    let unreadable = 0;
    const found = new Map();
    for (const path of files) {
        let src;
        try { src = readFileSync(join(ROOT, path), 'utf8'); } catch { unreadable += 1; continue; }
        const r = cfg.detect(src);
        sites += r.sites;
        if (r.violations.length) found.set(path, r.violations);
    }
    const fresh = [];
    for (const [p, v] of found) if (v.length > (baseline[p] ?? 0)) fresh.push(p);
    const total = [...found.values()].reduce((n, v) => n + v.length, 0);

    console.log(`\n${tag} ${files.length} file(s) scanned (${counted.length} by independent count) | ${sites} candidate site(s) | `
        + `${total} violation(s) | ${Object.keys(baseline).length} baselined file(s) | ${fresh.length} over baseline | ${unreadable} unreadable`);

    let failed = false;
    if (files.length === 0) { console.error(`${tag} scanned ZERO files. A scan of nothing is not a clean scan.`); failed = true; }
    if (files.length !== counted.length) {
        console.error(`${tag} file listing disagrees with the independent count (${files.length} vs ${counted.length}).`);
        failed = true;
    }
    if (unreadable > 0) { console.error(`${tag} ${unreadable} file(s) could not be read.`); failed = true; }
    const missed = missedControls(cfg.detect, cfg.controls);
    if (cfg.controls.length === 0 || missed.length > 0) {
        console.error(`${tag} BROKEN: the detector missed its own planted violation for rule(s): ${missed.join(', ') || '(no controls configured)'}. A clean scan means nothing.`);
        failed = true;
    }
    if (fresh.length) {
        console.error(`\n${fresh.length} file(s) over baseline:\n`);
        for (const p of fresh) for (const v of found.get(p)) console.error(`   ${p}:${v.line}  [${v.rule}] ${v.message}`);
        console.error('');
        for (const l of cfg.fixHint) console.error(l);
        console.error('');
        failed = true;
    }
    if (failed) process.exit(1);
    console.log(`${tag} OK\n`);
}
