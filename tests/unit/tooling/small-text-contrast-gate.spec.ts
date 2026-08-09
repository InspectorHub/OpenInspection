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
type Violation = {
    path: string;
    line: number;
    token: string;
    surface: string;
    origin: string;
    failures: Failure[];
};
type Debt = { file: string; match: string; reason: string };
type Palette = { fg: string; bg: string; theme: string; ratio: number; reason: string };
type Unresolved = { path: string; line: number; why: string };
type Useless = { path: string; line: number; token: string };

let gate: {
    AA_NORMAL: number;
    THEMES: Array<{ name: string; marker: string }>;
    KNOWN_DEBT: Debt[];
    PALETTE_DEBT: Palette[];
    contrastRatio(fg: string, bg: string): number | null;
    resolveVar(css: string, themeIndex: number, prop: string): string | null;
    aliasMap(css: string): Map<string, string>;
    smallestSize(chunk: string): number | null;
    foregroundTokens(chunk: string): string[];
    backgroundTokens(chunk: string): string[];
    classChunks(source: string): Array<{ text: string; line: number }>;
    surfaceAnnotations(source: string): Map<number, { token: string; line: number }>;
    findViolations(input: {
        css: string;
        files: Array<{ path: string; source: string }>;
        debt?: Debt[];
        palette?: Palette[];
    }): {
        violations: Violation[];
        staleDebt: Debt[];
        stalePalette: Palette[];
        unresolved: Unresolved[];
        uselessAnnotations: Useless[];
        checked: number;
    };
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

/** A component file with arbitrary body, for annotation and lexer cases. */
const raw = (source: string) => ({ path: 'packages/shared-ui/src/Fixture.tsx', source });

const scan = (files: Array<{ path: string; source: string }>, palette: Palette[] = []) =>
    gate.findViolations({ css: CSS, files, debt: [], palette });

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

describe('surface inference: the element paints its own background', () => {
    it('POSITIVE CONTROL: inverse text on an inverse surface is NOT reported', () => {
        // The whole reason `app/` was out of scope. Under the old one-surface
        // assumption this measured #fff on #fff = 1.00:1 and was reported 109
        // times across the app, every one of them white text on a filled
        // control that reads perfectly. `checked` pins that it was examined and
        // cleared, not skipped.
        const { violations, checked } = scan([fixture('text-[11px] text-ih-fg-inverse bg-ih-bg-inverse')]);
        expect(checked).toBe(1);
        expect(violations).toEqual([]);
    });

    it('POSITIVE CONTROL: inverse text on the brand primary is not reported as a site defect', () => {
        // The pairing is legitimate — a filled button. It is also 4.47:1 in
        // light, which is a fact about the PALETTE, recorded once. With that
        // record in place the call site is silent...
        const withRecord = scan(
            [fixture('text-[12px] text-ih-fg-inverse bg-ih-primary')],
            gate.PALETTE_DEBT,
        );
        expect(withRecord.violations).toEqual([]);
        expect(withRecord.stalePalette.map((p) => p.bg)).not.toContain('--ih-primary');

        // ...and without it the gate still sees the shortfall, in light only,
        // measured against the button and not against a card. This is the
        // assertion that stops the exemption from being a blindfold.
        const bare = scan([fixture('text-[12px] text-ih-fg-inverse bg-ih-primary')]);
        expect(bare.violations).toHaveLength(1);
        expect(bare.violations[0].surface).toBe('--ih-primary');
        expect(bare.violations[0].origin).toBe('element');
        expect(bare.violations[0].failures.map((f) => f.theme)).toEqual(['light']);
        expect(bare.violations[0].failures[0].ratio).toBeCloseTo(4.47, 2);
    });

    it('ACCUSES too: fg-3 clears AA on a card and fails on bg-ih-bg-muted', () => {
        // Surface inference is not only an excuse mechanism. Light `--ih-fg-3`
        // on `--ih-bg-muted` (#f1f5f9) is 4.34:1, so "move small text to fg-3"
        // is not universally sufficient and the gate has to say so.
        expect(scan([fixture('text-[11px] text-ih-fg-3')]).violations).toEqual([]);

        const { violations } = scan([fixture('text-[11px] text-ih-fg-3 bg-ih-bg-muted')]);
        expect(violations).toHaveLength(1);
        expect(violations[0].surface).toBe('--ih-bg-muted');
        expect(violations[0].failures.map((f) => f.theme)).toEqual(['light']);
        expect(violations[0].failures[0].ratio).toBeCloseTo(4.34, 2);
    });

    it('reads only UNPREFIXED backgrounds — a hover tint is not the resting surface', () => {
        expect(gate.backgroundTokens('bg-ih-bg-card hover:bg-ih-bg-muted')).toEqual(['bg-card']);
        // Same fg-3, but the muted surface only exists under the pointer.
        expect(scan([fixture('text-[11px] text-ih-fg-3 hover:bg-ih-bg-muted')]).violations).toEqual([]);
    });
});

describe('surfaces the scanner refuses to guess', () => {
    it('skips and COUNTS ambiguous, alpha and unknown backgrounds', () => {
        const { violations, unresolved, checked } = scan([
            { path: 'a.tsx', source: '<p className="text-[11px] text-ih-fg-4 bg-ih-bg-card bg-ih-bg-inverse" />' },
            { path: 'b.tsx', source: '<p className="text-[11px] text-ih-fg-4 bg-ih-bg-muted/60" />' },
            { path: 'c.tsx', source: '<p className="text-[11px] text-ih-fg-4 bg-ih-bg-input" />' },
        ]);
        // Every one of these would be a violation if measured against the
        // default card. None is reported, and none is silently dropped.
        expect(violations).toEqual([]);
        expect(checked).toBe(0);
        expect(unresolved.map((u) => u.why)).toEqual([
            expect.stringContaining('two backgrounds'),
            expect.stringContaining('alpha'),
            expect.stringContaining('not in the @theme block'),
        ]);
    });
});

describe('the call-site surface annotation', () => {
    const painted = (extra: string) =>
        raw(
            'export function F() {\n' +
                '  return (\n' +
                '    <div className="bg-ih-bg-inverse">\n' +
                `      {/* contrast-surface: bg-ih-bg-inverse */}\n` +
                `      <p className="${extra}">hi</p>\n` +
                '    </div>\n' +
                '  );\n' +
                '}\n',
        );

    it('lets an author name the surface an ANCESTOR paints', () => {
        // Without the annotation this is white-on-white by assumption.
        const bare = scan([fixture('text-[11px] text-ih-fg-inverse')]);
        expect(bare.violations).toHaveLength(1);
        expect(bare.violations[0].origin).toBe('default');

        const annotated = scan([painted('text-[11px] text-ih-fg-inverse')]);
        expect(annotated.checked).toBe(1);
        expect(annotated.violations).toEqual([]);
        expect(annotated.uselessAnnotations).toEqual([]);
    });

    it('reports an annotation that is not doing any work, so it cannot rot', () => {
        // fg-2 clears AA on the annotated surface AND on the card it would
        // otherwise have been measured against. The annotation changes nothing,
        // and a suppression that changes nothing is how one outlives its reason.
        const idle = raw(
            'export function F() {\n' +
                '  return (\n' +
                '    <div className="bg-ih-bg-card">\n' +
                '      {/* contrast-surface: bg-ih-bg-card */}\n' +
                '      <p className="text-[11px] text-ih-fg-2">hi</p>\n' +
                '    </div>\n' +
                '  );\n' +
                '}\n',
        );
        const { violations, uselessAnnotations } = scan([idle]);
        expect(violations).toEqual([]);
        expect(uselessAnnotations).toHaveLength(1);
        expect(uselessAnnotations[0].token).toBe('bg-card');
    });

    it('does not treat the words in ordinary code as an annotation', () => {
        const notAComment = raw('const s = "contrast-surface: bg-ih-bg-inverse";\n' +
            'export const C = <p className="text-[11px] text-ih-fg-inverse" />;\n');
        expect(gate.surfaceAnnotations(notAComment.source).size).toBe(0);
        expect(scan([notAComment]).violations).toHaveLength(1);
    });
});

describe('PALETTE_DEBT — a colour pair recorded with its measurement pinned', () => {
    const entry = (over: Partial<Palette> = {}): Palette => ({
        fg: '--ih-primary',
        bg: '--ih-bg-card',
        theme: 'light',
        ratio: 4.47,
        reason: 'test',
        ...over,
    });

    it('excuses exactly the pair, theme and measurement it names', () => {
        const files = [fixture('text-[13px] text-ih-primary')];
        expect(scan(files).violations).toHaveLength(1);
        expect(scan(files, [entry()]).violations).toEqual([]);
        expect(scan(files, [entry()]).stalePalette).toEqual([]);

        // Right pair, wrong theme.
        expect(scan(files, [entry({ theme: 'dark' })]).violations).toHaveLength(1);
        // Right pair and theme, wrong surface.
        expect(scan(files, [entry({ bg: '--ih-bg-muted' })]).violations).toHaveLength(1);
    });

    it('goes STALE when the palette moves, instead of covering the new number', () => {
        // The staleness guard is the entire difference between a record and a
        // mute button: edit the token and the gate demands the decision again.
        const drifted = scan([fixture('text-[13px] text-ih-primary')], [entry({ ratio: 4.2 })]);
        expect(drifted.violations).toHaveLength(1);
        expect(drifted.stalePalette).toHaveLength(1);
    });

    it('goes stale when nothing in the tree pairs those colours any more', () => {
        const gone = scan([fixture('text-[13px] text-ih-fg-2')], [entry()]);
        expect(gone.violations).toEqual([]);
        expect(gone.stalePalette).toHaveLength(1);
    });

    it('every shipped entry still measures what it claims', () => {
        const idx = (name: string) => gate.THEMES.findIndex((t) => t.name === name);
        for (const p of gate.PALETTE_DEBT) {
            const i = idx(p.theme);
            expect(i, `${p.theme} is not a theme`).toBeGreaterThanOrEqual(0);
            const measured = gate.contrastRatio(
                gate.resolveVar(CSS, i, p.fg)!,
                gate.resolveVar(CSS, i, p.bg)!,
            );
            expect(measured, `${p.fg} on ${p.bg} (${p.theme})`).toBeCloseTo(p.ratio, 2);
            expect(measured!, `${p.fg} on ${p.bg} is no longer a failure`).toBeLessThan(gate.AA_NORMAL);
        }
    });
});

describe('the source lexer', () => {
    it('does not let a URL glob open a block comment', () => {
        // `https://*.inspectorhub.io/...` in agent/settings-profile.tsx opened a
        // phantom `/*` that ran to the next `*/`, blanking real markup and
        // leaving an unbalanced quote — four bogus reports on one line plus
        // silent loss of coverage over everything it swallowed.
        // The trailing block comment is load-bearing: it supplies the `*/` the
        // phantom runs to. Without one, a blind strip finds no closing delimiter
        // and does no damage — which is how a test of this can pass vacuously.
        const src =
            'const preview = `https://*.example.io/book/<slug>`;\n' +
            'export const C = <p className="text-[11px] text-ih-fg-4">x</p>;\n' +
            '/* trailing note */\n';
        expect(gate.classChunks(src).map((c) => c.text)).toContain('text-[11px] text-ih-fg-4');
        expect(scan([raw(src)]).violations).toHaveLength(1);
    });

    it('does not read a JSX closing tag as a regex literal', () => {
        // `</kbd>`, `<span> / <span>` and `{expr}</td>` all put a `/` where the
        // textbook "expression position" heuristic expects a regex. Each one
        // swallowed the next className whole.
        const src =
            '<p>press<kbd className="text-[10px] text-ih-fg-4">?</kbd>' +
            '<kbd className="text-[10px] text-ih-fg-4">Esc</kbd></p>;\n';
        expect(gate.classChunks(src)).toHaveLength(2);
    });

    it('still knows a real regex literal, so `//` inside one is not a comment', () => {
        // Same line as the className, deliberately: the escaped `\\//` ends in a
        // literal `//`, and if that is read as a line comment everything after
        // it on the line disappears. On a line of its own there is nothing left
        // to lose and the assertion proves nothing.
        const src =
            'const re = /https?:\\/\\//; export const C = ' +
            '<p className="text-[11px] text-ih-fg-4">x</p>;\n';
        expect(gate.classChunks(src).map((c) => c.text)).toEqual(['text-[11px] text-ih-fg-4']);
    });

    it('reports the line of the class string, not of the phantom that preceded it', () => {
        const src = "// the card's overflow\nconst a = 1;\n" +
            'export const C = <p className="text-[11px] text-ih-fg-4">x</p>;\n';
        expect(gate.classChunks(src)[0].line).toBe(3);
    });
});

describe('the real tree', () => {
    it('Table headers use fg-3 — 10px is normal-size text for WCAG', () => {
        // Was 2.56:1 / 3.07:1 and parked in KNOWN_DEBT. It is the column header
        // of every table in the product, so it gets pinned in two places.
        const src = readFileSync(path.join(ROOT, 'packages/shared-ui/src/Table.tsx'), 'utf8');
        expect(src).toContain('text-ih-fg-3');
        expect(src).not.toContain('text-ih-fg-4');
    });

    it('has no un-exempted small-text contrast failures, and was actually scanned', async () => {
        const { readdirSync, statSync } = await import('node:fs');
        const dirs = ['packages/shared-ui/src', 'app'];
        const walk = (d: string, acc: string[] = []): string[] => {
            for (const name of readdirSync(d)) {
                const full = path.join(d, name);
                if (statSync(full).isDirectory()) {
                    if (name !== 'paraglide' && name !== 'node_modules') walk(full, acc);
                } else if (
                    /\.tsx?$/.test(name) &&
                    !/\.d\.ts$/.test(name) &&
                    !/\.test\.tsx?$/.test(name)
                ) {
                    acc.push(full);
                }
            }
            return acc;
        };
        const files = dirs.flatMap((d) =>
            walk(path.join(ROOT, d)).map((full) => ({
                path: path.relative(ROOT, full).split(path.sep).join('/'),
                source: readFileSync(full, 'utf8'),
            })),
        );

        const { violations, checked, stalePalette, uselessAnnotations } = gate.findViolations({
            css: CSS,
            files,
            // Debt is keyed by an OS-specific path in the script; re-key it for
            // the posix-style paths this spec builds.
            debt: gate.KNOWN_DEBT.map((d) => ({ ...d, file: d.file.split(path.sep).join('/') })),
            palette: gate.PALETTE_DEBT,
        });

        // Two thousand, not twenty: `app/` is now in scope, and the number is
        // here so a scan that quietly stops seeing the app cannot read as clean.
        expect(checked).toBeGreaterThan(2000);
        expect(violations.map((v) => `${v.path}:${v.line} ${v.token} on ${v.surface}`)).toEqual([]);
        expect(stalePalette).toEqual([]);
        expect(uselessAnnotations).toEqual([]);
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
