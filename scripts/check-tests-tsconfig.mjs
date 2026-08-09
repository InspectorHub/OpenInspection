#!/usr/bin/env node
/**
 * scripts/check-tests-tsconfig.mjs
 *
 * Ratchet for `tsconfig.tests.json`'s `exclude` array — the burn-down list of
 * spec files that do not yet type-check.
 *
 * WHY A GATE AND NOT A COMMENT. `tsconfig.tests.json` is the first program that
 * ever compiled `tests/**`, and it landed with 198 files carved out of it. An
 * exclude list with nothing holding it is a list that grows: the cheapest way
 * past a red `type-check:tests` is one more line, and nobody reviewing a diff of
 * 200 similar-looking paths notices the 201st. So the array is mirrored into
 * `scripts/tests-tsconfig-baseline.json` and this gate refuses any entry that is
 * not already there.
 *
 * The gate is deliberately DUMB about types. It never runs tsc — it compares two
 * sorted string lists. That is what makes it affordable in pre-commit (~2 ms)
 * and what makes it truthful: it cannot be fooled by a compile that was skipped.
 *
 * FOUR VERDICTS:
 *   1. equal                    → pass.
 *   2. tsconfig has an entry the baseline does not (GROWTH)
 *                               → fail. This is the whole point.
 *   3. baseline has an entry the tsconfig no longer does (a file was CLEANED)
 *                               → fail, with `--update` as the fix. A ratchet
 *                                 whose baseline is never tightened silently
 *                                 re-permits everything it already forgave.
 *   4. a ratchet entry names a file that no longer exists
 *                               → fail. A stale entry lies about how much debt
 *                                 is left, and it survives renames invisibly.
 *
 * ⚠️ EXCLUDE IS NOT SUPPRESSION. `exclude` only removes files from the `include`
 * expansion; a file still enters the program if an included file IMPORTS it.
 * Excluding a shared helper under tests/unit/helpers/ therefore does nothing on
 * its own — every spec that imports it has to be excluded too. That is measured
 * fact, not theory: the initial list needed a second sweep to converge, and four
 * otherwise-clean specs are on it for exactly this reason. If you add a non-spec
 * file here, add its importers in the same commit or the gate you are trying to
 * satisfy will not go green.
 *
 * MODES
 *   (none)              verify. Exit 1 on any verdict above.
 *   --update            baseline := tsconfig, but ONLY if that shrinks it.
 *                       Growth is refused here too; there is no flag for it.
 *   --seed-from <file>  one-time bootstrap. Reads a `tsc` output log, extracts
 *                       every file that reported an error, prints the array to
 *                       paste into tsconfig.tests.json, and writes the baseline.
 *                       Refuses once the baseline is marked seeded — the escape
 *                       hatch exists for the first single-process compile after
 *                       Phase 0, not for the next red build.
 *
 * END STATE: when the ratchet reaches zero this file and its baseline are
 * deleted, and `scripts/check-test-layout.mjs` gains a one-line assertion that
 * `tsconfig.tests.json` excludes nothing but the structural four. That script
 * already owns "every spec is collected by exactly one config".
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TSCONFIG = 'tsconfig.tests.json';
const BASELINE = 'scripts/tests-tsconfig-baseline.json';

/**
 * Entries that are NOT debt. They describe the program's shape and must never
 * be counted, ratcheted, or burned down:
 *   node_modules / dist / .types — build output and dependencies.
 *   tests/e2e/**                 — owned by tsconfig.playwright.json, which
 *                                  holds a deliberately tight 2048 MB cap.
 */
export const STRUCTURAL = ['node_modules', 'dist', '.types', 'tests/e2e/**'];

/**
 * Strip `//` line comments from JSONC.
 *
 * Only whole-line comments are removed, because that is the only form
 * `tsconfig.tests.json` uses and a general stripper has to understand string
 * literals to avoid eating a `//` inside a path. Keeping it line-based keeps it
 * correct; if a trailing comment ever appears the JSON.parse below fails loudly
 * rather than silently dropping half a line.
 */
export function stripJsonc(text) {
    return text.replace(/^\s*\/\/.*$/gm, '');
}

/** Split an `exclude` array into its structural and ratchet halves. */
export function splitExclude(exclude, structural = STRUCTURAL) {
    const set = new Set(structural);
    return {
        structural: exclude.filter((e) => set.has(e)),
        ratchet: exclude.filter((e) => !set.has(e)),
    };
}

/**
 * Compare the tsconfig's ratchet against the baseline's.
 * `added` is growth (forbidden); `removed` is progress the baseline has not
 * recorded yet.
 */
export function diffRatchet(current, baseline) {
    const base = new Set(baseline);
    const cur = new Set(current);
    return {
        added: current.filter((e) => !base.has(e)).sort(),
        removed: baseline.filter((e) => !cur.has(e)).sort(),
    };
}

/**
 * The whole verdict, as data. Takes an `exists` predicate rather than touching
 * the filesystem so the spec can drive it with a fake tree.
 */
export function evaluate({ current, baseline, exists }) {
    const { added, removed } = diffRatchet(current, baseline);
    const missing = current.filter((e) => !e.includes('*') && !exists(e)).sort();
    const violations = [];

    if (added.length) {
        violations.push(
            `${added.length} file(s) ADDED to tsconfig.tests.json's exclude. The list may only shrink.\n` +
                added.map((e) => `    + ${e}`).join('\n') +
                `\n  Fix the types instead. If a file genuinely cannot be checked yet, that is a\n` +
                `  decision to argue for in review, not one to make with a one-line diff.`,
        );
    }
    if (removed.length) {
        violations.push(
            `${removed.length} file(s) left the exclude list but are still in the baseline.\n` +
                removed.map((e) => `    - ${e}`).join('\n') +
                `\n  This is progress the ratchet has not recorded — run: npm run lint:tests-tsconfig -- --update`,
        );
    }
    if (missing.length) {
        violations.push(
            `${missing.length} excluded path(s) match no file on disk (deleted or renamed).\n` +
                missing.map((e) => `    ? ${e}`).join('\n') +
                `\n  A stale entry overstates the remaining debt and hides a rename. Delete it.`,
        );
    }
    return { added, removed, missing, violations, ok: violations.length === 0 };
}

/** Pull the erroring file paths out of a `tsc` output log. */
export function parseTscErrors(log) {
    const files = new Set();
    for (const line of log.split(/\r?\n/)) {
        const m = /^([^\s(][^(]*)\(\d+,\d+\): error TS\d+/.exec(line);
        if (m) files.add(m[1].replace(/\\/g, '/'));
    }
    return [...files].sort();
}

// ── CLI ───────────────────────────────────────────────────────────────────
function readRatchet() {
    const raw = readFileSync(path.join(ROOT, TSCONFIG), 'utf8');
    const parsed = JSON.parse(stripJsonc(raw));
    return splitExclude(parsed.exclude ?? []).ratchet;
}

function readBaseline() {
    return JSON.parse(readFileSync(path.join(ROOT, BASELINE), 'utf8'));
}

function writeBaseline(obj) {
    writeFileSync(path.join(ROOT, BASELINE), `${JSON.stringify(obj, null, 2)}\n`);
}

function main() {
    const argv = process.argv.slice(2);
    const seedIdx = argv.indexOf('--seed-from');

    if (seedIdx !== -1) {
        const logPath = argv[seedIdx + 1];
        if (!logPath) {
            console.error('--seed-from needs a path to a tsc output log');
            process.exit(1);
        }
        const baseline = readBaseline();
        if (baseline.seeded) {
            console.error(
                'Baseline is already seeded. --seed-from is a ONE-TIME bootstrap for the first\n' +
                    'single-process compile, not a way to absorb a new red build.',
            );
            process.exit(1);
        }
        const files = parseTscErrors(readFileSync(logPath, 'utf8'));
        writeBaseline({ ...baseline, seeded: true, excluded: files });
        console.log(`Seeded ${files.length} file(s). Paste into tsconfig.tests.json's exclude:\n`);
        console.log(files.map((f) => `        ${JSON.stringify(f)},`).join('\n'));
        return;
    }

    const current = readRatchet();
    const baseline = readBaseline();

    if (argv.includes('--update')) {
        const { added } = diffRatchet(current, baseline.excluded);
        if (added.length) {
            console.error(
                '--update refuses to record growth. The ratchet only shrinks.\n' +
                    added.map((e) => `    + ${e}`).join('\n'),
            );
            process.exit(1);
        }
        writeBaseline({ ...baseline, excluded: current });
        console.log(`tests-tsconfig baseline updated: ${current.length} file(s) still excluded.`);
        return;
    }

    const result = evaluate({
        current,
        baseline: baseline.excluded,
        exists: (p) => existsSync(path.join(ROOT, p)),
    });

    if (!result.ok) {
        console.error(`tsconfig.tests.json exclude ratchet:\n  ${result.violations.join('\n  ')}`);
        process.exit(1);
    }
    console.log(`tests tsconfig ratchet OK — ${current.length} file(s) still excluded from type-check:tests`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
