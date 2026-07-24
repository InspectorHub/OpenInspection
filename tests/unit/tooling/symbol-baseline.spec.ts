/**
 * Unit tests for the shared symbol-keyed baseline helpers
 * (`scripts/lib/symbol-baseline.mjs`), used by the tenant-scoping and
 * status-literal anti-drift gates.
 *
 * Symbol keys (`relpath::symbol::signature`) are drift-immune: inserting or
 * removing a line above a frozen hit does NOT renumber it, so the baseline
 * does not spuriously fail. `signature` keeps per-hit granularity so a NEW hit
 * added to an already-baselined function is still caught.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { pathToFileURL, fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));

let lib: {
    enclosingSymbol: (source: string, index: number) => string;
    normalizeSignature: (text: string) => string;
    makeKey: (relpath: string, symbol: string, signature: string) => string;
    diffBaseline: (
        current: Map<string, string>,
        baseline: Set<string>,
    ) => { violations: string[]; stale: string[] };
};

beforeAll(async () => {
    const scriptPath = path.resolve(HERE, '../../../scripts/lib/symbol-baseline.mjs');
    lib = await import(/* @vite-ignore */ pathToFileURL(scriptPath).href);
});

describe('enclosingSymbol', () => {
    it('finds the nearest preceding top-level function declaration', () => {
        const source = [
            'function alpha() {',
            '  return 1;',
            '}',
            'function beta() {',
            "  const x = 'hit-here';",
            '}',
        ].join('\n');
        const idx = source.indexOf('hit-here');
        expect(lib.enclosingSymbol(source, idx)).toBe('beta');
    });

    it('finds a const/arrow declaration', () => {
        const source = ['export const doThing = () => {', "  const s = 'x';", '};'].join('\n');
        expect(lib.enclosingSymbol(source, source.indexOf("'x'"))).toBe('doThing');
    });

    it('finds an enclosing class method (not the call inside it)', () => {
        const source = [
            'class Svc {',
            '  async confirmBooking(id: string): Promise<void> {',
            '    await this.db.update({});',
            "    const target = 'confirmed';",
            '  }',
            '}',
        ].join('\n');
        expect(lib.enclosingSymbol(source, source.indexOf("'confirmed'"))).toBe('confirmBooking');
    });

    it('does not treat a control-flow keyword or a bare call as a symbol', () => {
        const source = [
            'function outer() {',
            '  if (cond) {',
            "    doStuff('here');",
            '  }',
            '}',
        ].join('\n');
        // The nearest real declaration is `outer`, not `if` or `doStuff`.
        expect(lib.enclosingSymbol(source, source.indexOf("'here'"))).toBe('outer');
    });

    it('falls back to <module> before any declaration', () => {
        const source = "const first = 'x';";
        expect(lib.enclosingSymbol(source, 0)).toBe('<module>');
    });
});

describe('normalizeSignature', () => {
    it('collapses whitespace and trims', () => {
        expect(lib.normalizeSignature("  status:   'confirmed'  ")).toBe("status: 'confirmed'");
    });

    it('is stable regardless of surrounding indentation (drift-immune)', () => {
        expect(lib.normalizeSignature("      .set({ status: 'completed' })")).toBe(
            lib.normalizeSignature(".set({ status: 'completed' })"),
        );
    });
});

describe('makeKey + diffBaseline', () => {
    it('composes a stable file::symbol::signature key', () => {
        expect(lib.makeKey('a/b.ts', 'fn', "status: 'x'")).toBe("a/b.ts::fn::status: 'x'");
    });

    it('flags a hit absent from the baseline as a violation', () => {
        const current = new Map([['a.ts::fn::sig', 'ctx']]);
        const { violations } = lib.diffBaseline(current, new Set());
        expect(violations).toEqual(['a.ts::fn::sig']);
    });

    it('passes a hit present in the baseline', () => {
        const current = new Map([['a.ts::fn::sig', 'ctx']]);
        const { violations } = lib.diffBaseline(current, new Set(['a.ts::fn::sig']));
        expect(violations).toEqual([]);
    });

    it('reports baseline entries no longer hit as stale (informational, not a failure)', () => {
        const current = new Map([['a.ts::fn::sig', 'ctx']]);
        const { violations, stale } = lib.diffBaseline(
            current,
            new Set(['a.ts::fn::sig', 'gone.ts::old::sig']),
        );
        expect(violations).toEqual([]);
        expect(stale).toEqual(['gone.ts::old::sig']);
    });

    it('distinguishes two different hits inside the same symbol (granularity kept)', () => {
        // Same file+symbol, different signatures — a second, NEW hit in an
        // already-baselined function must still be caught.
        const current = new Map([
            ["s.ts::fn::status: 'confirmed'", 'ctx1'],
            ["s.ts::fn::status: 'completed'", 'ctx2'],
        ]);
        const baseline = new Set(["s.ts::fn::status: 'confirmed'"]);
        const { violations } = lib.diffBaseline(current, baseline);
        expect(violations).toEqual(["s.ts::fn::status: 'completed'"]);
    });
});
