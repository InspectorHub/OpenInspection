/**
 * Unit tests for rule 9 of the DS conformance gate (`scripts/check-ds-tokens.mjs`):
 * every `ih-*` alias in a class string must have an `@theme` entry.
 *
 * The defect it exists for: `bg-ih-bg-input` had 17 call sites and no
 * `--color-ih-bg-input` anywhere, so Tailwind emitted no CSS and those inputs
 * painted no background at all. Nine more names were in the same state
 * (`bg-ih-status-watch-bg`, `text-ih-danger`, `text-ih-fg-muted`,
 * `text-ih-good-fg`, `text-ih-accent`, `bg-ih-bad-tint`, `bg-ih-bg-1`,
 * `bg-ih-surface`, `border-ih-line`). `lint:ds` was green on every one of them
 * for as long as they existed, because the question it asked was whether the
 * name LOOKS like a token — and to that question an undefined token and a
 * defined one are indistinguishable.
 *
 * Nothing here is allowed to pass vacuously:
 *   - a POSITIVE CONTROL asserts a DEFINED token is not reported, so the rule
 *     cannot pass by flagging everything;
 *   - a synthetic undefined token MUST be reported (if the scanner stops
 *     matching, this is the test that goes red);
 *   - deleting a real `@theme` entry must make the REAL tree fail, which is the
 *     same red-then-green check run by hand when the rule was written;
 *   - the real-tree scan asserts a non-zero number of utilities was examined,
 *     so a moved directory cannot turn "clean" into "saw nothing".
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const CSS = readFileSync(path.join(ROOT, 'app/styles/tailwind.css'), 'utf8');

type Violation = { path: string; line: number; utility: string; why: string };

let gate: {
    PREFIX_NAMESPACES: Record<string, string[]>;
    themeAliases(css: string): Map<string, Set<string>>;
    findUnresolvedAliases(input: {
        css: string;
        files: Array<{ path: string; source: string }>;
    }): { violations: Violation[]; checked: number };
};

beforeAll(async () => {
    const scriptPath = path.resolve(ROOT, 'scripts/check-ds-tokens.mjs');
    gate = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href);
});

/** A component file body with one class string in it. */
const fixture = (cls: string) => ({
    path: 'packages/shared-ui/src/Fixture.tsx',
    source: `export function Fixture() {\n  return <p className="${cls}" />;\n}\n`,
});

const scan = (cls: string, css = CSS) =>
    gate.findUnresolvedAliases({ css, files: [fixture(cls)] });

describe('reading the @theme block', () => {
    it('groups aliases by the namespace their utility reads from', () => {
        const t = gate.themeAliases(CSS);
        expect(t.get('color')).toContain('ih-bg-card');
        expect(t.get('radius')).toContain('ih-modal');
        expect(t.get('spacing')).toContain('ih-list');
        expect(t.get('shadow')).toContain('ih-popover');
        expect(t.get('animate')).toContain('ih-slide-in-right');
        // `ih-card` is deliberately three different things. That is exactly why
        // the check is namespaced and not a flat name lookup.
        expect(t.get('radius')).toContain('ih-card');
        expect(t.get('spacing')).toContain('ih-card');
        expect(t.get('shadow')).toContain('ih-card');
        expect(t.get('color')).not.toContain('ih-card');
    });

    it('picks up the SECOND @theme block, not just the first', () => {
        // The animation tokens live in a separate `@theme` near the bottom of
        // the stylesheet. A parser that stops at the first block reports every
        // `animate-ih-*` in the product as undefined.
        expect(gate.themeAliases(CSS).get('animate')).toContain('ih-dash-march');
    });

    it('refuses to run against a stylesheet with no ih-* aliases', () => {
        expect(() => scan('bg-ih-bg-card', ':root { --x: 1px; }')).toThrow(/approves everything/);
    });
});

describe('the rule itself', () => {
    it('POSITIVE CONTROL: a DEFINED token is examined and not reported', () => {
        const { violations, checked } = scan('text-[11px] text-ih-fg-3 bg-ih-bg-card rounded-ih-card');
        expect(checked).toBe(3);
        expect(violations).toEqual([]);
    });

    it('reports a name with no @theme entry anywhere', () => {
        // The shipped defect, verbatim.
        const { violations } = scan('h-9 px-3 rounded-md border border-ih-border bg-ih-bg-input');
        expect(violations).toHaveLength(1);
        expect(violations[0].utility).toBe('bg-ih-bg-input');
        expect(violations[0].why).toContain('no @theme entry at all');
        expect(violations[0].line).toBe(2);
    });

    it('reports the raw CSS variable name written where the alias belongs', () => {
        // `--ih-status-watch-bg` is the custom property; the utility is
        // `bg-ih-watch-bg`. The two read almost identically, which is how one
        // shipped in AddPersonModal.
        expect(scan('bg-ih-status-watch-bg').violations).toHaveLength(1);
        expect(scan('bg-ih-watch-bg').violations).toEqual([]);
    });

    it('reports a name that exists in the WRONG namespace, and says which', () => {
        // `shadow-ih-card` is the elevation token and is fine; `bg-ih-card`
        // names the same string in a namespace `bg-` cannot read, and Tailwind
        // is just as silent about it as about a name that does not exist.
        expect(scan('shadow-ih-card').violations).toEqual([]);
        const { violations } = scan('bg-ih-card');
        expect(violations).toHaveLength(1);
        expect(violations[0].why).toContain('--radius-ih-card');
        expect(violations[0].why).toContain('--color-ih-card');
    });

    it('sees through variant prefixes — a hover state compiles to nothing too', () => {
        expect(scan('hover:bg-ih-bad-tint').violations).toHaveLength(1);
        expect(scan('peer-checked:bg-ih-primary md:text-ih-fg-2').violations).toEqual([]);
    });

    it('does not read a --color-ih-* DECLARATION as a `color-` utility', () => {
        // `brandTokens()` writes these as inline style properties. Treating the
        // declaration as a utility would make the gate fail on the one file
        // whose job is defining tokens.
        const decl = {
            path: 'app/lib/brand.ts',
            source: 'export const t = { "--color-ih-primary": c, "--ih-primary-fg": fg };\n',
        };
        expect(gate.findUnresolvedAliases({ css: CSS, files: [decl] })).toEqual({
            violations: [],
            checked: 0,
        });
    });

    it('checks an unfamiliar prefix against every namespace rather than skipping it', () => {
        // An unknown prefix must not become a hole. `mask-ih-nope` is not a real
        // utility, but the NAME is still checkable and still missing.
        expect(gate.PREFIX_NAMESPACES['mask-image']).toBeUndefined();
        expect(scan('mask-image-ih-nope').violations).toHaveLength(1);
        expect(scan('mask-image-ih-primary').violations).toEqual([]);
    });
});

describe('the real tree', () => {
    const realFiles = () => {
        const walk = (d: string, acc: string[] = []): string[] => {
            for (const name of readdirSync(d)) {
                const full = path.join(d, name);
                if (statSync(full).isDirectory()) {
                    if (name !== 'paraglide' && name !== 'node_modules') walk(full, acc);
                } else if (/\.tsx?$/.test(name)) acc.push(full);
            }
            return acc;
        };
        return ['app', 'packages/shared-ui/src'].flatMap((d) =>
            walk(path.join(ROOT, d)).map((full) => ({
                path: path.relative(ROOT, full).split(path.sep).join('/'),
                source: readFileSync(full, 'utf8'),
            })),
        );
    };

    it('every ih-* alias in app/ and shared-ui resolves, and there were thousands', () => {
        const { violations, checked } = gate.findUnresolvedAliases({ css: CSS, files: realFiles() });
        expect(violations.map((v) => `${v.path}:${v.line} ${v.utility}`)).toEqual([]);
        // Thousands, not dozens: the number is here so a scan that quietly stops
        // seeing the app cannot read as clean.
        expect(checked).toBeGreaterThan(5000);
    });

    it('RED-THEN-GREEN: deleting one @theme entry makes the real tree fail', () => {
        // The observation that proves the rule is load-bearing rather than
        // decorative, pinned so it survives a refactor of the parser.
        const blinded = CSS.replace('--color-ih-watch-bg: var(--ih-status-watch-bg);', '');
        expect(blinded).not.toBe(CSS);

        const { violations } = gate.findUnresolvedAliases({ css: blinded, files: realFiles() });
        expect(violations.length).toBeGreaterThan(20);
        expect(violations.every((v) => v.utility.endsWith('ih-watch-bg'))).toBe(true);
        expect(violations[0].why).toContain('no @theme entry at all');
    });
});
