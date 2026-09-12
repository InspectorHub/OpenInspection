/**
 * The four blind spots `scripts/check-contrast.mjs` used to name in its own
 * comments, now closed — one describe block each.
 *
 * Both defects these tests were written for were found by a runtime contrast
 * probe in a browser, not by this gate, while the gate stayed green:
 *
 *   F33 — `--ih-primary-fg` was REFERENCED by the `@theme` alias
 *   (`var(--ih-primary-fg, #ffffff)`) and DECLARED in no theme block. The alias
 *   fallback meant the browser painted white in all three themes: 4.53:1 on the
 *   light primary fill, 2.98:1 on the dark and field one. The gate said nothing
 *   because the token resolved to `null`, `contrastRatio(null, …)` returned
 *   `null`, and the per-theme loop read `null` as "not measurable" and skipped it
 *   without counting it. A token a stylesheet never declares is not a
 *   measurement problem; it is a defect.
 *
 *   F34 — `--ih-fg-4` (a DECORATION tier: 2.56:1 light, 3.07:1 dark on a card)
 *   used as a text colour, in the three shapes the gate could not see: set in a
 *   CSS rule rather than a utility (`.ih-eyebrow`), sized by a sibling BEM base
 *   rule (`.ih-pill` / `.ih-pill--ni`), and written in a ternary branch inside a
 *   template literal's `${…}` where the size lives in the template (the TabStrip
 *   count pill, 2.34:1 on light muted).
 *
 * Every case here is red-then-green: a fixture that reproduces the shipped shape
 * and MUST be reported, paired with the corrected shape that must not be. A gate
 * extension with no failing fixture proves only that it runs.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CSS = readFileSync(path.join(ROOT, 'app/styles/tailwind.css'), 'utf8');

/* eslint-disable @typescript-eslint/no-explicit-any */
let gate: any;
/* eslint-enable @typescript-eslint/no-explicit-any */

beforeAll(async () => {
    gate = await import(
        /* @vite-ignore */ pathToFileURL(path.resolve(ROOT, 'scripts/check-contrast.mjs')).href
    );
});

const file = (source: string) => ({ path: 'packages/shared-ui/src/Fixture.tsx', source });
const scan = (source: string) =>
    gate.findViolations({ css: CSS, files: [file(source)], debt: [], palette: [] });

/** Minimal three-theme stylesheet, so alias/CSS-rule cases need no real tokens. */
const sheet = (extra: { theme?: string; root?: string; dark?: string; field?: string }) => `
@theme {
  --color-ih-bg-card: var(--ih-bg-card);
  --color-ih-fg-1: var(--ih-fg-1);
  --color-ih-fg-4: var(--ih-fg-4);
${extra.theme ?? ''}
}
:root { --ih-bg-card: #ffffff; --ih-fg-1: #0f172a; --ih-fg-4: #94a3b8;
${extra.root ?? ''} }
html[data-color-scheme="dark"], html[data-color-scheme="field"], .dark {
  --ih-bg-card: #1e293b; --ih-fg-1: #f1f5f9; --ih-fg-4: #64748b;
${extra.dark ?? ''} }
html[data-color-scheme="field"] { --ih-bg-card: #0f172a;
${extra.field ?? ''} }
`;

/* ── blind spot 1: an @theme alias pointing at a token nobody declares ── */

describe('an @theme alias whose target is never declared (F33)', () => {
    it('RED: is reported, and the `var(…, #fff)` fallback does not excuse it', () => {
        const css = sheet({ theme: '  --color-ih-primary-fg: var(--ih-primary-fg, #ffffff);' });
        const failures = gate.checkAliasDefinitions(css);
        expect(failures).toHaveLength(1);
        expect(failures[0].prop).toBe('--ih-primary-fg');
        expect(failures[0].themes).toEqual(['light', 'dark', 'field']);
        // The fallback is surfaced, because it is what the browser actually paints.
        expect(failures[0].fallback).toBe('#ffffff');
    });

    it('GREEN: declaring it per theme clears the check', () => {
        const css = sheet({
            theme: '  --color-ih-primary-fg: var(--ih-primary-fg);',
            root: '  --ih-primary-fg: #ffffff;',
            dark: '  --ih-primary-fg: #0f172a;',
            field: '  --ih-primary-fg: #0f172a;',
        });
        expect(gate.checkAliasDefinitions(css)).toEqual([]);
    });

    it('a declared but NON-hex value (rgba) is not a missing declaration', () => {
        const css = sheet({
            theme: '  --color-ih-tint: var(--ih-tint);',
            root: '  --ih-tint: rgba(99, 102, 241, 0.10);',
        });
        expect(gate.checkAliasDefinitions(css)).toEqual([]);
    });

    it('THE REAL TREE: --ih-primary-fg is declared in all three themes and pairs >= 4.5:1', () => {
        expect(gate.checkAliasDefinitions(CSS)).toEqual([]);
        for (const [i, theme] of gate.THEMES.entries()) {
            const fg = gate.resolveVar(CSS, i, '--ih-primary-fg');
            const bg = gate.resolveVar(CSS, i, '--ih-primary');
            expect(fg, `--ih-primary-fg in ${theme.name}`).toMatch(/^#[0-9a-f]{3,6}$/i);
            expect(gate.contrastRatio(fg, bg)).toBeGreaterThanOrEqual(gate.AA_NORMAL);
        }
    });

    it('an unmeasurable pairing is COUNTED, not silently dropped', () => {
        // fg-1 on a translucent surface: the surface resolves, the maths cannot.
        const css = sheet({
            theme: '  --color-ih-tint: var(--ih-tint);',
            root: '  --ih-tint: rgba(99, 102, 241, 0.10);',
            dark: '  --ih-tint: rgba(99, 102, 241, 0.10);',
        });
        const r = gate.findViolations({
            css,
            files: [file('const c = "text-[11px] bg-ih-tint text-ih-fg-1";\n')],
            debt: [],
            palette: [],
        });
        expect(r.unmeasurable.length).toBeGreaterThan(0);
        expect(r.violations).toEqual([]);
    });
});

/* ── blind spot 2: a colour set in CSS instead of a utility ── */

describe('colours set in the stylesheet itself (F34, .ih-eyebrow)', () => {
    it('RED: a 9px rule painting fg-4 on the reference surface is reported', () => {
        const css = `${sheet({})}\n.ih-eyebrow { font-size: 9px; color: var(--ih-fg-4); }\n`;
        const r = gate.findCssRuleViolations(css);
        const themes = r.failures.map((f: { theme: string }) => f.theme);
        // All three here: this synthetic sheet lets field inherit the dark fg-4.
        // The REAL sheet restates field's fg-4 brighter, so it fails light + dark
        // only — which is what the walkthrough measured in the browser.
        expect(themes).toEqual(['light', 'dark', 'field']);
        expect(r.failures[0].selector).toBe('.ih-eyebrow');
        expect(r.failures[0].sizePx).toBe(9);
    });

    it('GREEN: the same rule with fg-3 clears all three themes', () => {
        const css = `${sheet({
            theme: '  --color-ih-fg-3: var(--ih-fg-3);',
            root: '  --ih-fg-3: #64748b;',
            dark: '  --ih-fg-3: #94a3b8;',
            field: '  --ih-fg-3: #cbd5e1;',
        })}\n.ih-eyebrow { font-size: 9px; color: var(--ih-fg-3); }\n`;
        expect(gate.findCssRuleViolations(css).failures).toEqual([]);
    });

    it('reads the rule OWN background when it paints one', () => {
        const css = `${sheet({
            theme: '  --color-ih-bg-muted: var(--ih-bg-muted);',
            root: '  --ih-bg-muted: #f1f5f9;',
            dark: '  --ih-bg-muted: #273549;',
            field: '  --ih-bg-muted: #1e293b;',
        })}\n.ih-kbd { font-size: 11px; background: var(--ih-bg-muted); color: var(--ih-fg-4); }\n`;
        const r = gate.findCssRuleViolations(css);
        expect(r.failures[0].bgProp).toBe('--ih-bg-muted');
    });

    it('takes a BEM modifier size from its BASE class — .ih-pill holds the 11px', () => {
        const css = `${sheet({})}
.ih-pill { font-size: 11px; font-weight: 700; }
.ih-pill--ni { background: var(--ih-bg-card); color: var(--ih-fg-4); }
`;
        const r = gate.findCssRuleViolations(css);
        expect(r.failures.length).toBeGreaterThan(0);
        expect(r.failures[0].selector).toBe('.ih-pill--ni');
        expect(r.failures[0].sizeFrom).toBe('base .ih-pill');
    });

    it('a rule whose size nothing declares is held to the 3:1 floor, not 4.5', () => {
        // fg-4 on a white card is 2.56 — below 3, so no size can rescue it.
        const below = `${sheet({})}\n.ih-mystery { color: var(--ih-fg-4); }\n`;
        expect(gate.findCssRuleViolations(below).failures.length).toBeGreaterThan(0);
        expect(gate.findCssRuleViolations(below).failures[0].threshold).toBe(gate.AA_LARGE);

        // A 3.5:1 pairing is between the two thresholds: not judged without a size.
        const between = `${sheet({ root: '  --ih-mid: #808080;', theme: '  --color-ih-mid: var(--ih-mid);', dark: '  --ih-mid: #808080;' })}
.ih-mystery { color: var(--ih-mid); }
`;
        expect(gate.findCssRuleViolations(between).failures).toEqual([]);
    });

    it('skips theme blocks — they declare token VALUES, not text', () => {
        const selectors = gate.cssTextRules(CSS).map((rule: { selector: string }) => rule.selector);
        expect(selectors).not.toContain(':root');
        expect(selectors.length).toBeGreaterThan(0);
    });

    it('THE REAL TREE: every stylesheet rule that paints text clears its threshold', () => {
        const r = gate.findCssRuleViolations(CSS);
        expect(r.failures).toEqual([]);
        // Not vacuous: something was actually measured.
        expect(r.checked).toBeGreaterThan(0);
    });
});

/* ── blind spot 3: class fragments inside a template literal's ${…} ── */

describe('class fragments assembled inside a template literal (F34, TabStrip pill)', () => {
    const pill = (token: string) =>
        'const c = `inline-flex text-[10px] font-bold ${\n' +
        '  active ? "bg-ih-bg-card text-ih-fg-1" : "bg-ih-bg-card ' +
        token +
        '"\n}`;\n';

    it('RED: the size comes from the template, the colour from the branch', () => {
        const r = scan(pill('text-ih-fg-4'));
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].token).toBe('fg-4');
        expect(r.violations[0].size).toBe(10);
    });

    it('GREEN: the corrected branch is not reported, and was still examined', () => {
        const r = scan(pill('text-ih-fg-1'));
        expect(r.violations).toEqual([]);
        expect(r.checked).toBeGreaterThan(0);
    });

    it('the branch SURFACE is read from the branch, not from the template', () => {
        const src =
            'const c = `text-[11px] ${\n' +
            '  on ? "bg-ih-bg-card text-ih-fg-4" : "text-ih-fg-1"\n' +
            '}`;\n';
        const r = scan(src);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].surface).toBe('--ih-bg-card');
        expect(r.violations[0].origin).toBe('element');
    });

    it('and falls back to the TEMPLATE surface when the branch names none', () => {
        const src =
            'const c = `text-[11px] bg-ih-bg-card ${\n' + '  on ? "text-ih-fg-4" : ""\n' + '}`;\n';
        const r = scan(src);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].surface).toBe('--ih-bg-card');
    });

    it('a fragment with no size ANYWHERE is counted as skipped, not judged', () => {
        const r = scan('const c = `p-2 ${ on ? "text-ih-fg-4" : "" }`;\n');
        expect(r.violations).toEqual([]);
        expect(r.sizeless.length).toBeGreaterThan(0);
    });

    it('recurses through a NESTED template literal', () => {
        const src =
            'const c = `text-[11px] ${ on ? `${ deep ? "text-ih-fg-4" : "" }` : "" }`;\n';
        const r = scan(src);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].token).toBe('fg-4');
    });
});

/* ── blind spot 4: which surface wins, and the hex escape hatch ── */

describe('surface precedence and the literal-hex annotation', () => {
    it("the element's OWN background beats an annotation covering the line", () => {
        // Both ternary branches sit on one line, so one annotation covers both.
        // The active branch paints bg-ih-bg-card itself and must be scored on it,
        // or a correct annotation for the other branch invents a failure here.
        const src =
            '// contrast-surface: #0f172a\n' +
            'const c = `text-[11px] ${ on ? "bg-ih-bg-card text-ih-fg-1" : "text-ih-fg-1" }`;\n';
        const r = scan(src);
        const origins = r.violations.map((v: { origin: string }) => v.origin);
        // fg-1 is near-black: fine on the white card, unreadable on #0f172a.
        expect(r.violations).toHaveLength(1);
        expect(origins).toEqual(['annotation']);
        expect(r.violations[0].surface).toBe('#0f172a');
    });

    it('a hex annotation is the surface in EVERY theme — a fixed chrome has one colour', () => {
        // fg-1 flips with the theme (#0f172a light, #f1f5f9 dark, #fff field), so a
        // fixed chrome fails in exactly one of them. That asymmetry IS the point:
        // the surface stayed put while the foreground moved, which is the defect
        // shape in the photo-studio toolbar.
        const src = '// contrast-surface: #0f172a\n' + 'const c = "text-[11px] text-ih-fg-1";\n';
        const r = scan(src);
        expect(r.violations).toHaveLength(1);
        expect(r.violations[0].surface).toBe('#0f172a');
        expect(r.violations[0].failures.map((f: { theme: string }) => f.theme)).toEqual(['light']);
        expect(r.violations[0].failures.every((f: { bg: string }) => f.bg === '#0f172a')).toBe(true);

        // And a foreground that is dark in ALL themes fails on it in all three.
        const always = scan('// contrast-surface: #0f172a\nconst c = "text-[11px] text-ih-fg-5";\n');
        expect(always.violations[0].failures.map((f: { theme: string }) => f.theme)).toEqual([
            'dark',
            'field',
        ]);
    });

    it('a token annotation still works, and still must do real work', () => {
        const src = '// contrast-surface: bg-ih-bg-card\n' + 'const c = "text-[11px] text-ih-fg-1";\n';
        const r = scan(src);
        expect(r.violations).toEqual([]);
        // It changes nothing, so it is reported as an annotation to delete.
        expect(r.uselessAnnotations).toHaveLength(1);
    });
});

/* ── the output contract: a verdict alone is not auditable ── */

describe('the gate prints BOTH numbers', () => {
    it('reports a checked count AND every skipped count, on a clean run', () => {
        const r = gate.findViolations({
            css: CSS,
            files: [file('const c = "text-[11px] text-ih-fg-1";\n')],
            debt: [],
            palette: [],
        });
        expect(r.violations).toEqual([]);
        for (const key of ['checked', 'fromContext'] as const) {
            expect(typeof r[key], key).toBe('number');
        }
        for (const key of ['unresolved', 'unmeasurable', 'sizeless'] as const) {
            expect(Array.isArray(r[key]), key).toBe(true);
        }
        expect(r.checked).toBeGreaterThan(0);
    });

    it('the CSS-rule pass reports its own checked and skipped counts', () => {
        const r = gate.findCssRuleViolations(CSS);
        expect(typeof r.checked).toBe('number');
        expect(Array.isArray(r.skipped)).toBe(true);
        // The real sheet has translucent status backgrounds in dark/field, so the
        // skipped list is non-empty — and that is the number that must stay visible.
        expect(r.skipped.length).toBeGreaterThan(0);
    });
});
