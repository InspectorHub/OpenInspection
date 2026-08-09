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

    /**
     * A method whose PARAMETER LIST WRAPS is still that method.
     *
     * These are regression tests for a live gate failure, and the failure mode
     * is the one this whole scheme exists to prevent: a resolver that skips the
     * wrapped declaration names the PREVIOUS method instead, so the hit keeps
     * its position but changes its key — and a key that moved is reported as a
     * brand-new violation. Widening a return type until Prettier wraps the
     * signature was enough to fail `lint:tenant-scope`, pointing at a method
     * containing no query at all.
     *
     * ⚠️ AND IT IS WORSE THAN A WRONG NAME. Two queries in two different
     * methods both resolved to the same previous sibling, so their keys were
     * IDENTICAL and the baseline — a Set — held one entry for both. Baselining
     * either one silently baselined the other. On a gate whose subject is
     * cross-tenant data leaks, that is a hole, not a cosmetic defect.
     */
    it('names a method whose parameter list wraps, not the method above it', () => {
        const source = [
            'class Svc {',
            '  async summarize(text: string) {',
            '    return this.call(text);',
            '  }',
            '',
            '  async loadOne(',
            '    tenantId: string,',
            '    id: string,',
            '  ): Promise<{ row: unknown; count: number | null }> {',
            "    const row = await db.select().where(eq(t.id, 'wanted'));",
            '  }',
            '}',
        ].join('\n');
        // The inline object type in the return position matters: a rest-pattern
        // that excludes `{` rejects this real shape and the walk falls through
        // to the constructor or the sibling above.
        expect(lib.enclosingSymbol(source, source.indexOf("'wanted'"))).toBe('loadOne');
    });

    it('keys two identical statements in different methods apart when both signatures wrap', () => {
        const line = '    await db.update(x).where(eq(t.id, id));';
        const source = [
            'class Svc {',
            '  async first(',
            '    id: string,',
            '  ): Promise<void> {',
            line,
            '  }',
            '',
            '  async second(',
            '    id: string,',
            '  ): Promise<void> {',
            line,
            '  }',
            '}',
        ].join('\n');
        const a = lib.enclosingSymbol(source, source.indexOf(line));
        const b = lib.enclosingSymbol(source, source.lastIndexOf(line));
        expect(a).toBe('first');
        expect(b).toBe('second');
        // The point of the previous two assertions: identical signatures under
        // a shared symbol collapse into ONE baseline entry.
        expect(new Set([lib.makeKey('f.ts', a, line), lib.makeKey('f.ts', b, line)]).size).toBe(2);
    });

    it('does not mistake a wrapped CALL for a declaration', () => {
        // `and(` / `or(` on their own line are drizzle predicates with wrapped
        // arguments, and they match a declaration's line shape exactly. Only
        // reading forward to the `{` after the closing paren tells them apart.
        const source = [
            'class Svc {',
            '  async listOpen(tenantId: string) {',
            '    return db.select().where(',
            '      and(',
            '        eq(t.tenantId, tenantId),',
            "        eq(t.status, 'open'),",
            '      ),',
            '    );',
            '  }',
            '}',
        ].join('\n');
        expect(lib.enclosingSymbol(source, source.indexOf("'open'"))).toBe('listOpen');
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
