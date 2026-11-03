import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
// @ts-expect-error -- plain .mjs helpers, no types alongside them (same as the other tooling specs).
import { detectPublicProjection, MIN_REASON } from '../../../scripts/lib/public-projection-detect.mjs';
// @ts-expect-error -- plain .mjs helper.
import { CONTROLS, DELEGATES, PUBLIC_MODULES, missedControls, publicMounts } from '../../../scripts/check-public-projection.mjs';

interface Hit { line: number; rule: string }
const run = (src: string) => detectPublicProjection(src, 'route.ts') as { sites: number; violations: Hit[] };
const rules = (src: string) => run(src).violations.map((v) => v.rule);
const NL = String.fromCharCode(10);
const route = (...body: string[]) => ['app.get("/x", async (c) => {', '  const row = await db.get();', ...body, '});'].join(NL);

/** Every flagged shape is paired with a clean control: a detector that flags nothing passes the clean cases, and one that flags everything passes the others. */
describe('public-projection detector', () => {
    it('counts each c.json as a scanned response', () => {
        expect(run(route('  return c.json({ success: true, data: 1 }, 200);')).sites).toBe(1);
        expect(run('const x = 1;').sites).toBe(0);
    });

    it('flags a bare row, a property of one, a spread of one and a service result', () => {
        expect(rules(route('  return c.json({ success: true, data: row }, 200);'))).toEqual(['unprojected-response']);
        expect(rules(route('  return c.json({ success: true, data: row.inspection }, 200);'))).toEqual(['unprojected-response']);
        expect(rules(route('  return c.json({ success: true, data: { ...row, extra: 1 } }, 200);'))).toEqual(['unprojected-response']);
        expect(rules(route('  return c.json({ success: true, data: await svc.list() }, 200);'))).toEqual(['unprojected-response']);
        expect(rules(route('  return c.json(row, 200);'))).toEqual(['unprojected-response']);
    });

    it('accepts a projection, a variable declared from one, an object of listed fields, a schema parse and a mapped projection', () => {
        expect(rules(route('  return c.json({ success: true, data: projectFields(row, FIELDS) }, 200);'))).toEqual([]);
        expect(rules(route('  const view = projectFields(row, FIELDS);', '  return c.json({ success: true, data: view }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: { id: row.id, name: row.name } }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: Schema.parse(row) }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: rows.map((r) => projectFields(r, FIELDS)) }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: { ...projectFields(row, FIELDS), tenantSlug: slug } }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: null }, 200);'))).toEqual([]);
    });

    it('does not follow a variable declared from a row, nor a name that is declared twice or taken as a parameter', () => {
        expect(rules(route('  const view = row;', '  return c.json({ success: true, data: view }, 200);'))).toEqual(['unprojected-response']);
        expect(rules('function f(view) { const a = 1; return c.json({ data: view }); }' + NL + 'const view = projectFields(1, []);')).toEqual(['unprojected-response']);
    });

    describe('which values and which forms are looked at', () => {
        it('looks at every property of the response, whatever its key, and a shorthand property', () => {
            expect(rules(route('  return c.json({ success: true, meta: row }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ success: false, error: row.error }, 400);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ success: true, row }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ [key]: row }, 200);'))).toEqual(['unprojected-response']);
        });
        it('takes the context from the first parameter of the handler, and follows sendSuccess, Response.json, new Response and body/text', () => {
            expect(rules('app.get("/x", async (ctx2) => { const row = await db.get(); return ctx2.json({ data: row }); });')).toEqual(['unprojected-response']);
            expect(rules('app.get("/x", async (c) => { const row = await db.get(); return sendSuccess(c, row); });')).toEqual(['unprojected-response']);
            expect(rules('app.get("/x", async (c) => { const row = await db.get(); return respondRelativizedJson(c, { success: true, data: row }, t); });')).toEqual(['unprojected-response']);
            expect(rules('app.get("/x", async (c) => { const row = await db.get(); return respondRelativizedJson(c, { success: true, data: projectFields(row, F) }, t); });')).toEqual([]);
            expect(rules(route('  return Response.json(row);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return new Response(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.body(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.text(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.body(JSON.stringify({ ok: true }));'))).toEqual([]);
            expect(run(route('  return c.redirect("/x");')).sites).toBe(1);
        });
    });

    describe('a row one level inside the data literal', () => {
        it('flags a variable declared from a service call or an awaited value, and a call, as a value of data', () => {
            expect(rules(route('  const mine = await svc.list();', '  return c.json({ data: { mine } }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ data: { request: await svc.get() } }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ data: { items: svc.items() } }, 200);'))).toEqual(['unprojected-response']);
        });
        it('accepts a projected value, a picked property, a literal and a parameter', () => {
            expect(rules(route('  const mine = projectThing(await svc.list());', '  return c.json({ data: { mine } }, 200);'))).toEqual([]);
            expect(rules(route('  return c.json({ data: { id: row.id, ok: true, n: 3 } }, 200);'))).toEqual([]);
            expect(rules('app.get("/x", async (c) => (n) => c.json({ data: { n } }, 200));')).toEqual([]);
        });
    });

    describe('which calls count as a projection', () => {
        const data = (expr: string) => rules(route(`  return c.json({ success: true, data: ${expr} }, 200);`));
        it('rejects a call that merely has a familiar name', () => {
            for (const expr of ['JSON.stringify(row)', 'JSON.parse(text)', 'row.parse()', 'obj.projectFields(row, F)', 'svc.min(row)', 'svc.keys(row)', 'svc.now()', 'row.toString()', 'rows.join(",")']) {
                expect(data(expr), expr).toEqual(['unprojected-response']);
            }
        });
        it('accepts the qualified forms, a project-named function and a schema parse', () => {
            for (const expr of ['Object.keys(row)', 'Math.max(1, 2)', 'Date.now()', 'Number(row.n)', 'String(row.n)', 'projectThing(row)', 'FooSchema.parse(row)', 'JSON.stringify({ id: row.id })', 'when.toISOString()']) {
                expect(data(expr), expr).toEqual([]);
            }
            expect(data('rows.map(projectThing)')).toEqual([]);
        });
        it('follows a function of the same file declared once, when everything it returns is projected', () => {
            const ok = 'function view(x) { return projectFields(x, F); }' + NL + route('  return c.json({ data: view(row) }, 200);');
            expect(rules(ok)).toEqual([]);
            const bad = 'function view(x) { return x; }' + NL + route('  return c.json({ data: view(row) }, 200);');
            expect(rules(bad)).toEqual(['unprojected-response']);
        });
    });

    describe('which variables are followed', () => {
        it('counts destructured bindings and parameters, so a projected name elsewhere is not borrowed', () => {
            const src = route('  const { view } = await svc.get();', '  return c.json({ data: view }, 200);') + NL + 'const view = projectFields(1, []);';
            expect(rules(src)).toEqual(['unprojected-response']);
        });
        it('resolves a name by scope, so the same name in two handlers is judged in each', () => {
            const src = [
                'app.get("/a", async (c) => { const data = projectFields(await db.get(), F); return c.json({ data }, 200); });',
                'app.get("/b", async (c) => { const data = await db.get(); return c.json({ data }, 200); });',
            ].join(NL);
            expect(run(src).violations).toHaveLength(1);
        });
    });

    describe('projection-allow', () => {
        it('exempts the statement under it when it gives a reason', () => {
            expect(rules(route('  // projection-allow: the row is the public listing itself', '  return c.json({ success: true, data: row }, 200);'))).toEqual([]);
        });
        it('is itself reported without a reason, or with a short one', () => {
            expect(rules(route('  // projection-allow:', '  return c.json({ success: true, data: row }, 200);'))).toEqual(['allow-without-reason']);
            expect(rules(route('  // projection-allow: ok', '  return c.json({ success: true, data: row }, 200);'))).toEqual(['allow-without-reason']);
            expect(MIN_REASON).toBeGreaterThanOrEqual(10);
        });
        it('covers only the handler under it, not a chain of expression-bodied handlers', () => {
            const src = ['// projection-allow: the first handler is a public listing', 'app.get("/a", (c) => c.json({ data: rowA }, 200))', '  .get("/b", (c) => c.json({ data: rowB }, 200));'].join(NL);
            // The marker covers the handler on the line under it and no other: the second one is still reported.
            expect(run(src).violations.map((v) => v.line)).toEqual([3]);
        });
        it('accepts the marker at the end of the call line', () => {
            expect(rules(route('  return c.json({ success: true, data: row }, 200); // projection-allow: the row is the public listing itself'))).toEqual([]);
        });
        it('exempts only the statement it sits above', () => {
            const src = route('  // projection-allow: the first one is a public listing', '  if (a) return c.json({ success: true, data: row }, 200);', '  return c.json({ success: true, data: row }, 200);');
            expect(rules(src)).toEqual(['unprojected-response']);
        });
    });
});

describe('the gate itself', () => {
    it('answers every planted control as stated, and notices a detector that does not', () => {
        expect(missedControls()).toEqual([]);
        expect(missedControls(() => ({ sites: 0, violations: [] }))).not.toEqual([]);
        expect(missedControls(() => ({ sites: 1, violations: [{ line: 1, rule: 'unprojected-response' }] }))).not.toEqual([]);
        expect(CONTROLS.length).toBeGreaterThanOrEqual(8);
    });

    it('lists the modules that serve public routes as data', () => {
        expect(PUBLIC_MODULES.length).toBeGreaterThan(0);
        expect(PUBLIC_MODULES.some((g: string) => g.includes('server/api/public/'))).toBe(true);
    });
});

describe('the gate run as a command', () => {
    const run = (script: string) => execFileSync(process.execPath, [script], { cwd: process.cwd(), encoding: 'utf8' });

    it('prints its summary with both numbers and ends OK, so a command that did nothing would fail here', () => {
        const out = run('scripts/check-public-projection.mjs');
        expect(out).toMatch(/\d+ module\(s\) scanned \(\d+ by independent count\) \| \d+ response\(s\) \| \d+ finding\(s\) vs \d+ baselined/);
        expect(out).toContain('[public-projection] OK');
    }, 120_000);

    it('does the same for the loader budget gate, which shares the entry-point idiom', () => {
        const out = run('scripts/check-loader-budget.mjs');
        expect(out).toMatch(/file\(s\) scanned/);
        expect(out).toContain('[loader-budget] OK');
    }, 120_000);

    it('finds the modules mounted under /api/public from the entry file itself', () => {
        const mounts = publicMounts("import repairBuilderRoutes from './api/repair-builder';" + NL + "import { clientMessageRoutes } from './api/messages';" + NL + "app.route('/api/public', repairBuilderRoutes).route('/api/public', clientMessageRoutes).route('/api/admin', other);");
        expect(mounts.map((m: { target: string }) => m.target)).toEqual(['server/api/repair-builder', 'server/api/messages']);
        expect(Object.keys(DELEGATES).length).toBeGreaterThan(0);
    });
});
