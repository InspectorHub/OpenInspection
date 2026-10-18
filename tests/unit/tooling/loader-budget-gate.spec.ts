import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain .mjs helpers, no types alongside them (same as the other tooling specs).
import { detectLoaderBudget, MAX_FANOUT } from '../../../scripts/lib/loader-budget-detect.mjs';
// @ts-expect-error -- plain .mjs helper.
import { CONTROLS, missedControls } from '../../../scripts/check-loader-budget.mjs';

interface Hit { line: number; rule: string }
const run = (src: string) => detectLoaderBudget(src, 'route.tsx') as { sites: number; violations: Hit[] };
const rules = (src: string) => run(src).violations.map((v) => v.rule);
const NL = String.fromCharCode(10);
const loader = (...body: string[]) => ['export async function loader({ request }) {', '  const api = createApi();', ...body, '}'].join(NL);

/**
 * Every violation shape is paired with a clean control: a detector that flags nothing passes the
 * clean cases, and one that flags everything passes the violation cases.
 */
describe('loader-budget detector', () => {
    describe('which functions are scanned', () => {
        it('scans an exported loader and clientLoader, and counts them', () => {
            const src = loader('  return 1;') + NL + 'export async function clientLoader() { return 2; }';
            expect(run(src).sites).toBe(2);
        });
        it('scans an exported arrow-function loader', () => {
            const src = 'export const loader = async () => { const api = createApi(); return Promise.all(ids.map((i) => api.x.$get({ param: { i } }))); };';
            expect(run(src).sites).toBe(1);
            expect(rules(src)).toEqual(['call-in-loop']);
        });
        it('ignores a function that is not an exported loader, even if it has the bad shape', () => {
            const src = 'async function helper() { const api = createApi(); return Promise.all(ids.map((i) => api.x.$get({ param: { i } }))); }' + NL
                + 'export async function action() { const api = createApi(); const a = await api.a.$get(); const b = await api.b.$get(); }';
            expect(run(src)).toEqual({ sites: 0, violations: [] });
        });
        it('counts a loader with nothing wrong as a scanned site with no violations', () => {
            expect(run(loader('  const a = await api.a.$get();', '  return a;'))).toEqual({ sites: 1, violations: [] });
        });
    });

    describe('fanout', () => {
        const calls = (n: number) => Array.from({ length: n }, (_, i) => `api.r${i}.$get()`).join(', ');
        it(`flags Promise.all over more than ${MAX_FANOUT} reads`, () => {
            expect(rules(loader(`  return Promise.all([${calls(MAX_FANOUT + 1)}]);`))).toEqual(['fanout']);
            expect(rules(loader(`  return Promise.allSettled([${calls(MAX_FANOUT + 1)}]);`))).toEqual(['fanout']);
        });
        it(`does not flag exactly ${MAX_FANOUT}`, () => {
            expect(rules(loader(`  return Promise.all([${calls(MAX_FANOUT)}]);`))).toEqual([]);
        });
    });

    describe('call-in-loop', () => {
        it('flags an API call inside .map', () => {
            expect(rules(loader('  return Promise.all(ids.map((id) => api.x.$get({ param: { id } })));'))).toEqual(['call-in-loop']);
        });
        it('flags an API call inside .forEach, a for-of and a while loop', () => {
            expect(rules(loader('  ids.forEach(async (id) => { await api.x.$get({ param: { id } }); });'))).toEqual(['call-in-loop']);
            expect(rules(loader('  for (const id of ids) { await api.x.$get({ param: { id } }); }'))).toEqual(['call-in-loop']);
            expect(rules(loader('  while (more) { await api.x.$get(); }'))).toEqual(['call-in-loop']);
        });
        it('reports a nested loop once, not once per level', () => {
            expect(rules(loader('  for (const a of as) { for (const b of bs) { await api.x.$get(); } }'))).toEqual(['call-in-loop']);
        });
        it('does not flag a .map that calls no API', () => {
            expect(rules(loader('  const a = await api.a.$get();', '  return rows.map((r) => r.id);'))).toEqual([]);
        });
        it('does not flag a loop that makes no API call', () => {
            expect(rules(loader('  for (const id of ids) { total += id; }', '  return total;'))).toEqual([]);
        });
    });

    describe('serial-independent', () => {
        it('flags two adjacent awaits where the second does not use the first', () => {
            expect(rules(loader('  const a = await api.a.$get();', '  const b = await api.b.$get();', '  return [a, b];'))).toEqual(['serial-independent']);
        });
        it('flags a bare await followed by another', () => {
            expect(rules(loader('  await api.a.$post();', '  const b = await api.b.$get();', '  return b;'))).toEqual(['serial-independent']);
        });
        it('does not flag when the second uses what the first produced', () => {
            expect(rules(loader('  const a = await api.a.$get();', '  const b = await api.b.$get({ param: { id: a.id } });', '  return b;'))).toEqual([]);
        });
        it('follows destructuring: a name bound by the first and used by the second is a dependency', () => {
            expect(rules(loader('  const { id } = await api.a.$get();', '  const b = await api.b.$get({ param: { id } });', '  return b;'))).toEqual([]);
        });
        it('does not flag awaits that are not adjacent (something in between uses the result)', () => {
            expect(rules(loader('  const a = await api.a.$get();', '  const data = await a.json();', '  const b = await api.b.$get({ param: { id: data.id } });', '  return b;'))).toEqual([]);
        });
        it('does not flag an await that is not an API call', () => {
            expect(rules(loader('  const a = await api.a.$get();', '  const b = await somethingElse();', '  return [a, b];'))).toEqual([]);
        });
    });

    describe('hand-built-response', () => {
        it('flags new Response(JSON.stringify(...))', () => {
            expect(rules('export async function loader() { return new Response(JSON.stringify({ ok: true })); }')).toEqual(['hand-built-response']);
        });
        it('does not flag a Response with a plain body, nor a data return', () => {
            expect(rules('export async function loader() { return new Response(null, { status: 204 }); }')).toEqual([]);
            expect(rules('export async function loader() { return { ok: true }; }')).toEqual([]);
        });
    });

    describe('loader-budget-allow', () => {
        it('exempts exactly the statement it sits above, when it gives a reason', () => {
            const src = loader('  const a = await api.a.$get();', '  // loader-budget-allow: the second read needs the first read\'s cookie side effect', '  const b = await api.b.$get();', '  return [a, b];');
            expect(rules(src)).toEqual([]);
        });
        it('does not exempt the next violation after it', () => {
            const src = loader(
                '  const a = await api.a.$get();',
                '  // loader-budget-allow: documented exception',
                '  const b = await api.b.$get();',
                '  const c = await api.c.$get();',
                '  return [a, b, c];',
            );
            expect(rules(src)).toEqual(['serial-independent']);
        });
        it('a marker with no reason is itself a violation and exempts nothing', () => {
            const src = loader('  const a = await api.a.$get();', '  // loader-budget-allow:', '  const b = await api.b.$get();', '  return [a, b];');
            expect(rules(src)).toEqual(['allow-without-reason']);
        });
    });

    describe('the gate\'s own controls', () => {
        it('every rule has a planted control and each fires', () => {
            expect(CONTROLS.map((c: { rule: string }) => c.rule).sort()).toEqual(['allow-without-reason', 'call-in-loop', 'fanout', 'hand-built-response', 'serial-independent']);
            expect(missedControls()).toEqual([]);
        });
        it('reports the rules a blind detector misses', () => {
            const blind = () => ({ sites: 0, violations: [] });
            expect(missedControls(blind).sort()).toEqual(['allow-without-reason', 'call-in-loop', 'fanout', 'hand-built-response', 'serial-independent']);
        });
    });
});
