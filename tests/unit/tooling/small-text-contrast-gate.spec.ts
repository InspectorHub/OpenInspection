/**
 * Unit tests for the small-text contrast gate (`scripts/check-contrast.mjs`).
 *
 * The defect the gate exists for: five shared-ui form controls (Input, Select,
 * Textarea, RadioGroup, RadioCardGroup) rendered their `hint` line as
 * `text-[11px] text-ih-fg-4` — 2.56:1 on a light card, 3.07:1 on a dark one,
 * against a 4.5:1 AA requirement. `lint:ds` was green on every one of them for
 * as long as they existed, because it validates token NAMES and `ih-fg-4` is a
 * perfectly legitimate name. Only arithmetic on the token's VALUE can see it.
 *
 * Nothing here is allowed to pass vacuously:
 *   - the maths is pinned against hand-computable WCAG reference pairs;
 *   - a synthetic `text-[11px] text-ih-fg-4` fixture MUST be reported (if the
 *     scanner ever stops matching, this is the test that goes red);
 *   - the real-tree scan asserts it examined a non-zero number of colours, so a
 *     moved directory cannot turn "clean" into "saw nothing".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CSS = readFileSync(path.join(ROOT, 'app/styles/tailwind.css'), 'utf8');

type Failure = { theme: string; fg: string; bg: string; ratio: number };
type Violation = { path: string; line: number; token: string; failures: Failure[] };
type Debt = { file: string; match: string; reason: string };

let gate: {
    AA_NORMAL: number;
    THEMES: Array<{ name: string; marker: string }>;
    KNOWN_DEBT: Debt[];
    contrastRatio(fg: string, bg: string): number | null;
    resolveVar(css: string, themeIndex: number, prop: string): string | null;
    aliasMap(css: string): Map<string, string>;
    smallestSize(chunk: string): number | null;
    foregroundTokens(chunk: string): string[];
    findViolations(input: {
        css: string;
        files: Array<{ path: string; source: string }>;
        debt?: Debt[];
    }): { violations: Violation[]; staleDebt: Debt[]; checked: number };
};

beforeAll(async () => {
    const scriptPath = path.resolve(ROOT, 'scripts/check-contrast.mjs');
    gate = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href);
});

/** A component file body with one class string in it. */
const fixture = (cls: string) => ({
    path: 'packages/shared-ui/src/Fixture.tsx',
    source: `export function Fixture({ hint }) {\n  return <p className="${cls}">{hint}</p>;\n}\n`,
});

describe('contrast maths', () => {
    it('matches the WCAG reference extremes', () => {
        expect(gate.contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
        expect(gate.contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    });

    it('is symmetric and handles 3-digit hex', () => {
        expect(gate.contrastRatio('#fff', '#000')).toBeCloseTo(21, 5);
        expect(gate.contrastRatio('#64748b', '#fff')).toBeCloseTo(
            gate.contrastRatio('#fff', '#64748b')!,
            10,
        );
    });

    it('reproduces the measured hint numbers from the real tokens', () => {
        // These are the values that make the defect real. If a token block is
        // edited, this test says so rather than silently re-baselining.
        expect(gate.contrastRatio('#94a3b8', '#ffffff')).toBeCloseTo(2.56, 2); // fg-4 light
        expect(gate.contrastRatio('#64748b', '#1e293b')).toBeCloseTo(3.07, 2); // fg-4 dark
        expect(gate.contrastRatio('#64748b', '#ffffff')).toBeCloseTo(4.76, 2); // fg-3 light
        expect(gate.contrastRatio('#94a3b8', '#1e293b')).toBeCloseTo(5.71, 2); // fg-3 dark
    });

    it('rejects non-hex values instead of scoring them', () => {
        expect(gate.contrastRatio('rgba(99, 102, 241, 0.10)', '#fff')).toBeNull();
    });
});

describe('stylesheet reading', () => {
    it('really reads each theme block (not the :root fallback)', () => {
        // The sibling distinctness spec once matched no dark selector, fell back
        // to :root, and "passed" its dark assertions against the light palette.
        expect(gate.resolveVar(CSS, 0, '--ih-bg-card')).toBe('#fff');
        expect(gate.resolveVar(CSS, 1, '--ih-bg-card')).toBe('#1e293b');
        expect(gate.resolveVar(CSS, 2, '--ih-bg-card')).toBe('#0f172a');
    });

    it('follows the cascade: field inherits fg-2 overrides, dark inherits :root fg-5', () => {
        expect(gate.resolveVar(CSS, 2, '--ih-fg-3')).toBe('#cbd5e1'); // field override
        expect(gate.resolveVar(CSS, 1, '--ih-fg-3')).toBe('#94a3b8'); // dark override
        expect(gate.resolveVar(CSS, 0, '--ih-fg-3')).toBe('#64748b'); // light base
    });

    it('maps utility suffixes to custom properties via the @theme block', () => {
        const alias = gate.aliasMap(CSS);
        expect(alias.get('fg-4')).toBe('--ih-fg-4');
        expect(alias.get('bad-fg')).toBe('--ih-status-bad-fg');
    });
});

describe('class-string scanning', () => {
    it('reads arbitrary and named sizes, taking the smallest', () => {
        expect(gate.smallestSize('text-[11px] text-ih-fg-3 mt-1')).toBe(11);
        expect(gate.smallestSize('text-xs font-bold')).toBe(12);
        expect(gate.smallestSize('text-sm text-[10px]')).toBe(10);
        expect(gate.smallestSize('font-bold text-ih-fg-1')).toBeNull();
    });

    it('ignores variant-prefixed colours — a placeholder is not body copy', () => {
        expect(gate.foregroundTokens('text-[11px] placeholder:text-ih-fg-4')).toEqual([]);
        expect(gate.foregroundTokens('text-[13px] hover:text-ih-fg-2')).toEqual([]);
        expect(gate.foregroundTokens('text-[11px] text-ih-fg-3')).toEqual(['fg-3']);
    });
});

describe('the gate itself', () => {
    it('POSITIVE CONTROL: flags an 11px hint written with ih-fg-4', () => {
        const { violations } = gate.findViolations({
            css: CSS,
            files: [fixture('text-[11px] text-ih-fg-4 mt-1')],
            debt: [],
        });
        expect(violations).toHaveLength(1);
        expect(violations[0].token).toBe('fg-4');
        const themes = violations[0].failures.map((f) => f.theme);
        expect(themes).toContain('light');
        expect(themes).toContain('dark');
        // Field mode raises fg-4 to #94a3b8 on a near-black card (~6.96:1), so
        // it genuinely passes there. Asserting that keeps the gate honest about
        // which themes are actually broken.
        expect(themes).not.toContain('field');
        expect(violations[0].failures[0].ratio).toBeLessThan(gate.AA_NORMAL);
    });

    it('accepts the same hint written with ih-fg-3 in all three themes', () => {
        const { violations, checked } = gate.findViolations({
            css: CSS,
            files: [fixture('text-[11px] text-ih-fg-3 mt-1')],
            debt: [],
        });
        expect(checked).toBe(1);
        expect(violations).toEqual([]);
    });

    it('does not police text large enough to be exempt from this rule', () => {
        const { violations, checked } = gate.findViolations({
            css: CSS,
            files: [fixture('text-2xl text-ih-fg-4')],
            debt: [],
        });
        expect(checked).toBe(0);
        expect(violations).toEqual([]);
    });

    it('an exemption suppresses the matching line and nothing else', () => {
        const debt: Debt[] = [
            { file: 'packages/shared-ui/src/Fixture.tsx', match: 'text-[11px] text-ih-fg-4', reason: 'test' },
        ];
        const excused = gate.findViolations({
            css: CSS,
            files: [fixture('text-[11px] text-ih-fg-4 mt-1')],
            debt,
        });
        expect(excused.violations).toEqual([]);
        expect(excused.staleDebt).toEqual([]);

        // Same exemption, a different offending line: still reported.
        const other = gate.findViolations({
            css: CSS,
            files: [fixture('text-[10px] text-ih-fg-4')],
            debt,
        });
        expect(other.violations).toHaveLength(1);
        expect(other.staleDebt).toEqual(debt);
    });

    it('reports an exemption that no longer matches any code, so it cannot rot', () => {
        const { staleDebt } = gate.findViolations({
            css: CSS,
            files: [fixture('text-[11px] text-ih-fg-3 mt-1')],
            debt: [
                { file: 'packages/shared-ui/src/Fixture.tsx', match: 'text-ih-fg-4', reason: 'gone' },
            ],
        });
        expect(staleDebt).toHaveLength(1);
    });

    it('refuses to run when the reference surface cannot be read', () => {
        // A token rename must break the gate loudly, not make it pass silently.
        const blinded = CSS.replace(/--ih-bg-card/g, '--ih-bg-card-renamed');
        expect(() => gate.findViolations({ css: blinded, files: [], debt: [] })).toThrow(
            /--ih-bg-card/,
        );
    });
});

describe('the real shared-ui tree', () => {
    it('has no un-exempted small-text contrast failures, and was actually scanned', async () => {
        const { readdirSync, statSync } = await import('node:fs');
        const dir = path.join(ROOT, 'packages/shared-ui/src');
        const walk = (d: string, acc: string[] = []): string[] => {
            for (const name of readdirSync(d)) {
                const full = path.join(d, name);
                if (statSync(full).isDirectory()) walk(full, acc);
                else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) acc.push(full);
            }
            return acc;
        };
        const files = walk(dir).map((full) => ({
            path: path.relative(ROOT, full).split(path.sep).join('/'),
            source: readFileSync(full, 'utf8'),
        }));

        const { violations, checked } = gate.findViolations({
            css: CSS,
            files,
            // Debt is keyed by an OS-specific path in the script; re-key it for
            // the posix-style paths this spec builds.
            debt: gate.KNOWN_DEBT.map((d) => ({ ...d, file: d.file.split(path.sep).join('/') })),
        });

        expect(checked).toBeGreaterThan(20);
        expect(violations.map((v) => `${v.path}:${v.line} ${v.token}`)).toEqual([]);
    });

    it('every hint-bearing control uses the same helper token', () => {
        // The original defect was five controls disagreeing with FileDropzone.
        // Pin the agreement rather than the five individual lines.
        const files = [
            'Input.tsx',
            'Select.tsx',
            'Textarea.tsx',
            'Radio.tsx',
            'RadioCardGroup.tsx',
            'FileDropzone.tsx',
        ];
        for (const f of files) {
            const src = readFileSync(path.join(ROOT, 'packages/shared-ui/src', f), 'utf8');
            const hintLine = src
                .split('\n')
                .find((l) => /\{hint\}<\/(p|span)>/.test(l));
            expect(hintLine, `${f} renders no hint`).toBeTruthy();
            expect(hintLine, `${f} hint token`).toContain('text-ih-fg-3');
        }
    });
});
