import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
// @ts-expect-error plain .mjs gate library, no types
import { executeCallIndices, executeCallSites, guardCalledInEnclosingFunction } from '../../../scripts/lib/execute-call-sites.mjs';

type Hit = { index: number; label: string };
const hits = (src: string): Hit[] => executeCallIndices(src);

/** One positive and one clean control per call shape. */
const SHAPES: Array<{ name: string; bad: string; clean: string }> = [
    { name: 'member call', bad: 'function f(ds) { ds.execute(c); }', clean: 'function f(ds) { ds.run(c); }' },
    { name: 'element access', bad: "function f(ds) { ds['execute'](c); }", clean: "function f(ds) { ds['run'](c); }" },
    { name: 'optional call', bad: 'function f(ds) { ds.execute?.(c); }', clean: 'function f(ds) { ds.run?.(c); }' },
    { name: 'optional receiver', bad: 'function f(ds) { ds?.execute(c); }', clean: 'function f(ds) { ds?.run(c); }' },
    { name: 'non-null receiver and line break', bad: 'function f(ds) { ds!\n  .execute (c); }', clean: 'function f(ds) { ds!\n  .run (c); }' },
    { name: 'call-result receiver', bad: 'function f() { useData().execute(c); }', clean: 'function f() { useData().run(c); }' },
    { name: 'destructure then call', bad: 'function f(ds) { const { execute } = ds; execute(c); }', clean: 'function f(ds) { const { run } = ds; run(c); }' },
    { name: 'rename then call', bad: 'function f(ds) { const { execute: run } = ds; run(c); }', clean: 'function f(ds) { const { other: run } = ds; run(c); }' },
    { name: 'parameter destructure (function)', bad: 'function F({ execute }) { execute(c); }', clean: 'function F({ other }) { other(c); }' },
    { name: 'parameter destructure (arrow)', bad: 'const F = ({ execute }) => execute(c);', clean: 'const F = ({ other }) => other(c);' },
    { name: 'parameter destructure with rename (arrow)', bad: 'const F = ({ execute: go }) => { go(c); };', clean: 'const F = ({ other: go }) => { go(c); };' },
    { name: 'nested destructure', bad: 'function f(x) { const { data: { execute } } = x; execute(c); }', clean: 'function f(x) { const { data: { other } } = x; other(c); }' },
    { name: 'assignment destructure', bad: 'function f(ds) { let execute; ({ execute } = ds); execute(c); }', clean: 'function f(ds) { let other; ({ other } = ds); other(c); }' },
    { name: 'alias by reference', bad: 'function f(ds) { const run = ds.execute; run(c); }', clean: 'function f(ds) { const run = ds.read; run(c); }' },
    { name: 'indirect call', bad: 'function f(ds) { ds.execute.call(ds, c); }', clean: 'function f(ds) { ds.read.call(ds, c); }' },
];

describe('executeCallIndices: one positive and one clean control per shape', () => {
    for (const s of SHAPES) {
        it(`flags ${s.name}`, () => {
            expect(hits(s.bad).length).toBeGreaterThanOrEqual(1);
        });
        it(`leaves the control for ${s.name} clean`, () => {
            expect(hits(s.clean)).toEqual([]);
        });
    }

    it('reports each call once, at the first character of the call expression', () => {
        const src = 'async function f(ds) { await ds.execute(c); }';
        expect(hits(src)).toEqual([{ index: src.indexOf('ds.execute'), label: 'ds.execute(' }]);
    });

    it('a rename is reported under the bound name, and the original name stays a different function', () => {
        const got = hits('function f(ds) { const { execute: run } = ds; run(c); execute(c); }');
        expect(got.map((h) => h.label)).toEqual(['run(']);
    });

    it('a bare execute( nothing destructured, or one outside the declaring scope, is a different function', () => {
        expect(hits('function go() { execute(c); }')).toEqual([]);
        expect(hits('function a(ds) { const { execute } = ds; } function b() { execute(c); }')).toEqual([]);
    });

    it('does not flag a method, a function, a type member, a comment or a string merely named execute', () => {
        expect(hits('class A { async execute(id) { return 1; } }')).toEqual([]);
        expect(hits('function execute(id) { return 1; }')).toEqual([]);
        expect(hits('interface DS { execute(id: string): void; }')).toEqual([]);
        expect(hits('type T = DS["execute"];')).toEqual([]);
        expect(hits('const o = { execute: 1 }; const s = "ds.execute(c)";')).toEqual([]);
    });

    it('a destructured name handed to something else is a reference, not a hidden call', () => {
        expect(hits('function f(ds) { const { execute } = ds; return wrap(execute); }').map((h) => h.label)).toEqual(['a reference to execute']);
    });

    it('works on TypeScript that TSX would misread', () => {
        expect(hits('const id = <T,>(x: T) => x; function f(ds) { ds.execute(c); }').length).toBe(1);
        expect(hits('function f<T>(ds: DS<T>) { return (ds as DS<T>).execute(c); }').length).toBe(1);
    });
});

describe('executeCallSites: the allow marker', () => {
    const nl = String.fromCharCode(10);
    const run = (src: string) => executeCallSites(src, src.split(nl));
    const ok = ['function go(ds) {', '  // busy-controls-allow: the hook guards this call itself', '  return ds.execute(c);', '}'].join(nl);
    it('honours a marker with a reason above the call', () => {
        expect(run(ok)).toEqual([]);
    });
    it('does not honour an empty reason or another marker name', () => {
        expect(run(ok.replace('the hook guards this call itself', ''))).toHaveLength(1);
        expect(run(ok.replace('busy-controls-allow', 'some-other-allow'))).toHaveLength(1);
    });
});

describe('guardCalledInEnclosingFunction: the guard must be CALLED in an enclosing function', () => {
    const at = (src: string) => hits(src)[0]!.index;
    const g = ['useFieldCommand'];
    it('a call in the same function body counts', () => {
        const src = 'function go(ds) { const run = useFieldCommand(); ds.execute(c); }';
        expect(guardCalledInEnclosingFunction(src, at(src), g)).toBe(true);
    });
    it('a call in an outer function counts for a nested handler', () => {
        const src = 'function Go(ds) { const run = useFieldCommand(); return () => { ds.execute(c); }; }';
        expect(guardCalledInEnclosingFunction(src, at(src), g)).toBe(true);
    });
    it('the word anywhere else does not: another function, a property, a string, a bare reference, top level', () => {
        const cases = [
            'function a() { useFieldCommand(); } function b(ds) { ds.execute(c); }',
            'function b(ds) { const o = { useFieldCommand: 1 }; ds.execute(c); }',
            'function b(ds) { const s = "useFieldCommand()"; ds.execute(c); }',
            'function b(ds) { const f = useFieldCommand; ds.execute(c); }',
            'useFieldCommand(); function b(ds) { ds.execute(c); }',
        ];
        for (const src of cases) expect(guardCalledInEnclosingFunction(src, at(src), g)).toBe(false);
    });
});

describe('the real call site', () => {
    it('packages/field-ui/src/context.tsx is still found', () => {
        const src = readFileSync('packages/field-ui/src/context.tsx', 'utf8');
        const blanked = src
            .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
            .replace(/\/\/[^\n]*/g, (m) => ' '.repeat(m.length));
        const found = executeCallIndices(blanked);
        // Both numbers printed so a zero cannot pass for a clean scan.
        console.log(`context.tsx: ${found.length} execute use(s), ${executeCallSites(blanked, src.split(/\r?\n/)).length} unexcused`);
        expect(found.map((h: Hit) => h.label)).toContain('dataSource.execute(');
    });
});
