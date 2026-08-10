/**
 * Unit tests for the `tsconfig.tests.json` exclude ratchet
 * (`scripts/check-tests-tsconfig.mjs`).
 *
 * `tsconfig.tests.json` is the first tsc program that ever compiled `tests/**`,
 * and it landed with 198 files carved out of it. The gate exists so that list
 * can only shrink; this spec exists so the gate cannot quietly stop detecting.
 *
 * ⚠️ A gate spec that only feeds it BAD input proves nothing — a function that
 * returns "violation" unconditionally passes that suite. Every detection case
 * below is therefore paired with a negative control (the same shape, minus the
 * defect, must come back clean), and the last block asserts the real committed
 * pair is in sync, which is the assertion that actually fires on a stale commit.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');

interface Verdict {
    added: string[];
    removed: string[];
    missing: string[];
    violations: string[];
    ok: boolean;
}

let STRUCTURAL: string[];
let stripJsonc: (text: string) => string;
let splitExclude: (
    exclude: string[],
    structural?: string[],
) => { structural: string[]; ratchet: string[] };
let diffRatchet: (current: string[], baseline: string[]) => { added: string[]; removed: string[] };
let evaluate: (input: {
    current: string[];
    baseline: string[];
    exists: (p: string) => boolean;
}) => Verdict;
let parseTscErrors: (log: string) => string[];

/** Everything exists — the default world for cases that are not about staleness. */
const allExist = () => true;

beforeAll(async () => {
    const scriptPath = path.resolve(ROOT, 'scripts/check-tests-tsconfig.mjs');
    ({ STRUCTURAL, stripJsonc, splitExclude, diffRatchet, evaluate, parseTscErrors } = await import(
        /* @vite-ignore */ pathToFileURL(scriptPath).href
    ));
});

describe('splitExclude', () => {
    it('separates the structural entries from the burn-down list', () => {
        const { structural, ratchet } = splitExclude([
            'node_modules',
            'dist',
            '.types',
            'tests/e2e/**',
            'tests/unit/reports/a.spec.ts',
        ]);
        expect(structural).toEqual(['node_modules', 'dist', '.types', 'tests/e2e/**']);
        expect(ratchet).toEqual(['tests/unit/reports/a.spec.ts']);
    });

    it('counts a structural entry as debt if it is ever dropped from STRUCTURAL', () => {
        // The distinction is a hardcoded list, so it is worth pinning: if
        // `tests/e2e/**` ever falls out of STRUCTURAL it becomes ratchet debt
        // that --update would happily absorb.
        expect(STRUCTURAL).toContain('tests/e2e/**');
        const { ratchet } = splitExclude(['tests/e2e/**'], ['node_modules']);
        expect(ratchet).toEqual(['tests/e2e/**']);
    });
});

describe('stripJsonc', () => {
    it('removes whole-line comments and leaves the JSON parseable', () => {
        const text = '{\n  // a comment\n  "exclude": ["a"]\n}';
        expect(JSON.parse(stripJsonc(text))).toEqual({ exclude: ['a'] });
    });

    it('does not touch a path that merely contains a slash pair', () => {
        const text = '{\n  "exclude": ["tests/unit/a.spec.ts"]\n}';
        expect(JSON.parse(stripJsonc(text)).exclude).toEqual(['tests/unit/a.spec.ts']);
    });
});

describe('diffRatchet', () => {
    it('reports nothing when the two lists agree (negative control)', () => {
        expect(diffRatchet(['a', 'b'], ['b', 'a'])).toEqual({ added: [], removed: [] });
    });

    it('reports growth as `added`', () => {
        expect(diffRatchet(['a', 'b'], ['a']).added).toEqual(['b']);
    });

    it('reports an unrecorded shrink as `removed`', () => {
        expect(diffRatchet(['a'], ['a', 'b']).removed).toEqual(['b']);
    });
});

describe('evaluate — the three verdicts, each against its own negative control', () => {
    it('passes when tsconfig and baseline match and every file exists', () => {
        const current = ['tests/unit/reports/a.spec.ts'];
        const verdict = evaluate({ current, baseline: [...current], exists: allExist });
        expect(verdict.ok).toBe(true);
        expect(verdict.violations).toEqual([]);
    });

    it('FAILS when a new file is excluded — the defect the gate exists for', () => {
        const baseline = ['tests/unit/reports/a.spec.ts'];
        const current = [...baseline, 'tests/unit/tooling/brand-new.spec.ts'];
        const verdict = evaluate({ current, baseline, exists: allExist });
        expect(verdict.ok).toBe(false);
        expect(verdict.added).toEqual(['tests/unit/tooling/brand-new.spec.ts']);
        expect(verdict.violations.join('\n')).toContain('may only shrink');
    });

    it('FAILS when a file was cleaned but the baseline still lists it', () => {
        const verdict = evaluate({
            current: [],
            baseline: ['tests/unit/reports/a.spec.ts'],
            exists: allExist,
        });
        expect(verdict.ok).toBe(false);
        expect(verdict.removed).toEqual(['tests/unit/reports/a.spec.ts']);
        expect(verdict.violations.join('\n')).toContain('--update');
    });

    it('FAILS when an excluded path no longer exists (rename or delete)', () => {
        const current = ['tests/unit/reports/gone.spec.ts'];
        const verdict = evaluate({ current, baseline: [...current], exists: () => false });
        expect(verdict.ok).toBe(false);
        expect(verdict.missing).toEqual(['tests/unit/reports/gone.spec.ts']);
    });

    it('does not call a glob missing just because no literal file matches it', () => {
        // Negative control for the case above: the staleness check must skip
        // patterns, or every wildcard entry would report as a dead path.
        const current = ['tests/unit/legacy/**'];
        const verdict = evaluate({ current, baseline: [...current], exists: () => false });
        expect(verdict.missing).toEqual([]);
        expect(verdict.ok).toBe(true);
    });

    it('reports all three defects at once rather than stopping at the first', () => {
        const verdict = evaluate({
            current: ['tests/unit/a.spec.ts', 'tests/unit/gone.spec.ts'],
            baseline: ['tests/unit/cleaned.spec.ts'],
            exists: (p) => p === 'tests/unit/a.spec.ts',
        });
        expect(verdict.added).toEqual(['tests/unit/a.spec.ts', 'tests/unit/gone.spec.ts']);
        expect(verdict.removed).toEqual(['tests/unit/cleaned.spec.ts']);
        expect(verdict.missing).toEqual(['tests/unit/gone.spec.ts']);
        expect(verdict.violations).toHaveLength(3);
    });
});

describe('parseTscErrors — the one-time seed path', () => {
    it('extracts each erroring file once, and ignores continuation lines', () => {
        const log = [
            "tests/unit/a.spec.ts(12,3): error TS2345: Argument of type 'x'",
            "  Property 'batch' is missing in type 'y'",
            'tests/unit/a.spec.ts(40,9): error TS2769: No overload matches this call.',
            'tests/unit/b.spec.ts(1,1): error TS2307: Cannot find module',
        ].join('\n');
        expect(parseTscErrors(log)).toEqual(['tests/unit/a.spec.ts', 'tests/unit/b.spec.ts']);
    });

    it('returns nothing for a clean log (negative control)', () => {
        expect(parseTscErrors('')).toEqual([]);
        expect(parseTscErrors('Found 0 errors.\n')).toEqual([]);
    });

    it('normalises Windows separators so the output can be pasted into a tsconfig', () => {
        expect(parseTscErrors('tests\\unit\\a.spec.ts(1,1): error TS1005: oops')).toEqual([
            'tests/unit/a.spec.ts',
        ]);
    });
});

describe('the committed pair', () => {
    const readRatchet = (): string[] => {
        const raw = readFileSync(path.join(ROOT, 'tsconfig.tests.json'), 'utf8');
        return splitExclude((JSON.parse(stripJsonc(raw)) as { exclude: string[] }).exclude).ratchet;
    };
    const readBaseline = (): { seeded: boolean; excluded: string[] } =>
        JSON.parse(readFileSync(path.join(ROOT, 'scripts/tests-tsconfig-baseline.json'), 'utf8'));

    it('tsconfig.tests.json and the baseline are in sync', () => {
        expect(diffRatchet(readRatchet(), readBaseline().excluded)).toEqual({
            added: [],
            removed: [],
        });
    });

    it('the ratchet is not empty yet — delete this file when it is', () => {
        // A guard against the ratchet silently emptying because someone widened
        // `exclude` to a glob instead of burning the list down. When the debt is
        // genuinely gone, the plan is to delete the gate, the baseline and this
        // spec, and move the assertion into scripts/check-test-layout.mjs.
        expect(readRatchet().length).toBeGreaterThan(0);
        expect(readRatchet().every((e) => e.endsWith('.ts') || e.endsWith('.tsx'))).toBe(true);
    });
});
