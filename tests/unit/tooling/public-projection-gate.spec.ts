import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs helpers, no types alongside them (same as the other tooling specs).
import { detectPublicProjection, MIN_REASON } from '../../../scripts/lib/public-projection-detect.mjs';
// @ts-expect-error -- plain .mjs helper.
import { CONTAINER_NAMES, CONTAINER_SUFFIX, JSON_COLUMN_NAMES, jsonColumnNamesIn } from '../../../scripts/lib/public-projection-containers.mjs';
// @ts-expect-error -- plain .mjs helper.
import { CONTROLS, DELEGATES, OUT_OF_SCOPE, PAGE_PATHS, PUBLIC_MODULES, missedControls, parseMounts, publicMounts, publicPathModules, readOpenPaths, readPathConstants } from '../../../scripts/check-public-projection.mjs';

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
        expect(rules(route('  return c.json({ success: true, data: { ...projectFields(row, FIELDS), tenantSlug: "acme" } }, 200);'))).toEqual([]);
        expect(rules(route('  return c.json({ success: true, data: { ...projectFields(row, FIELDS), tenantSlug: slug } }, 200);'))).toEqual(['unprojected-response']);
        expect(rules(route('  return c.json({ success: true, data: null }, 200);'))).toEqual([]);
    });

    it('does not follow a variable declared from a row, nor a name that is declared twice or taken as a parameter', () => {
        expect(rules(route('  const view = row;', '  return c.json({ success: true, data: view }, 200);'))).toEqual(['unprojected-response']);
        expect(rules('function f(view) { const a = 1; return c.json({ data: view }); }' + NL + 'const view = projectFields(1, []);')).toEqual(['unprojected-response']);
    });

    describe('which values and which forms are looked at', () => {
        it('looks at every property of the response, whatever its key, and a shorthand property', () => {
            expect(rules(route('  return c.json({ success: true, meta: row }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ success: false, error: row.inner }, 400);'))).toEqual(['unprojected-response']);
            // A property picked under its own name is a field pick only inside a literal, never as a top-level key of the response.
            expect(rules(route('  return c.json({ success: false, error: row.error }, 400);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ success: false, error: { message: row.message } }, 400);'))).toEqual([]);
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
        it('accepts a projected value, a picked property and a literal, and reports a parameter of unknown origin', () => {
            expect(rules(route('  const mine = projectThing(await svc.list());', '  return c.json({ data: { mine } }, 200);'))).toEqual([]);
            expect(rules(route('  return c.json({ data: { id: row.id, ok: true, n: 3 } }, 200);'))).toEqual([]);
            expect(rules('app.get("/x", async (c) => (n) => c.json({ data: { n } }, 200));')).toEqual(['unprojected-response']);
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

    describe('a row at any depth inside the response', () => {
        const nested = (expr: string, ...pre: string[]) => rules(route(...pre, `  return c.json({ data: ${expr} }, 200);`));
        it('flags a property, a spread, a parameter, a let and a destructured binding of a row', () => {
            expect(nested('{ item: row.inner }')).toEqual(['unprojected-response']);
            expect(nested('{ item: { ...row } }')).toEqual(['unprojected-response']);
            expect(nested('{ a: { b: row } }', '  let more = 1;')).toEqual(['unprojected-response']);
            expect(rules('function f(c, row) { return c.json({ data: { item: row } }); }')).toEqual(['unprojected-response']);
            expect(rules('app.get("/x", async (c) => { let row = await db.get(); return c.json({ data: { a: { b: row } } }); });')).toEqual(['unprojected-response']);
            expect(rules('app.get("/x", async (c) => { const { inner } = await db.get(); return c.json({ data: { a: { b: inner } } }); });')).toEqual(['unprojected-response']);
        });
        it('accepts a property picked under its own name, a literal and a projection at the same depth', () => {
            expect(nested('{ item: { id: row.id, name: row.name } }')).toEqual([]);
            expect(nested('{ a: { b: projectFields(row, F) } }')).toEqual([]);
            expect(nested('{ a: { b: 1, c: "x", d: null } }')).toEqual([]);
        });
    });

    describe('forms that look like a projection and are not', () => {
        it('inspects a stringified row given to newResponse, html or Response, and accepts a stringified literal', () => {
            expect(rules(route('  return c.newResponse(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.html(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return new Response(JSON.stringify(row));'))).toEqual(['unprojected-response']);
            expect(rules(route('  return new Response(JSON.stringify({ data: { id: row.id } }));'))).toEqual([]);
        });
        it('does not take a comma expression for a field pick', () => {
            expect(rules(route('  return c.json({ data: (0, row) }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ data: row.a + row.b }, 200);'))).toEqual([]);
        });
        it('inspects a function of the same file that is named like a projector, and accepts one imported from the projection module', () => {
            const local = 'function projectThing(x) { return x; }' + NL + route('  return c.json({ data: projectThing(row) }, 200);');
            expect(rules(local)).toEqual(['unprojected-response']);
            const wrong = 'import { projectThing } from "../lib/other";' + NL + route('  return c.json({ data: projectThing(row) }, 200);');
            expect(rules(wrong)).toEqual(['unprojected-response']);
            const right = 'import { projectThing } from "../lib/response-projection";' + NL + route('  return c.json({ data: projectThing(row) }, 200);');
            expect(rules(right)).toEqual([]);
        });
        it('reports a response helper it does not know', () => {
            expect(rules(route('  return jsonOk(c, row);'))).toEqual(['unknown-response-helper']);
            expect(rules(route('  return sendSuccess(c, projectFields(row, F));'))).toEqual([]);
        });
        it('accepts a schema parse, and does not accept one whose schema is z.any()', () => {
            expect(rules(route('  return c.json({ data: PublicSchema.parse(row) }, 200);'))).toEqual([]);
            expect(rules('const S = z.any();' + NL + route('  return c.json({ data: S.parse(row) }, 200);'))).toEqual(['unprojected-response']);
        });
    });

    describe('a field picked by name', () => {
        const data = (expr: string) => rules(route(`  return c.json({ success: true, data: ${expr} }, 200);`));
        it('is a pick only nested inside a literal, and only from a plain identifier', () => {
            expect(data('{ id: row.id, name: row.name ?? null }')).toEqual([]);
            for (const name of ['id', 'name', 'status', 'createdAt', 'email', 'propertyAddress']) expect(data(`{ ${name}: row.${name} }`), name).toEqual([]);
        });
        it('is not a pick when the member is a container name, or ends in Row, Rows, Data or List', () => {
            for (const name of ['items', 'rows', 'settings', 'config', 'metadata', 'photos', 'inspection', 'body', 'rest', 'userRow', 'auditRows', 'formData', 'itemList']) {
                expect(data(`{ ${name}: row.${name} }`), name).toEqual(['unprojected-response']);
            }
            expect(rules(route('  return c.json({ data: { settings: row.settings } }, 200);'))).toEqual(['unprojected-response']);
            // A length is a number, whatever it is the length of; a marker on the line keeps a verified one.
            expect(data('{ length: row.length }')).toEqual([]);
            expect(rules(route('  return c.json({ data: { items: row.items } }, 200); // projection-allow: the list is a literal built above from named fields'))).toEqual([]);
            expect(data('{ items: projectFields(row, F), n: rows.length }')).toEqual([]);
        });
        it('refuses every container name, every derived JSON column name and every suffix as a nested pick key', () => {
            const suffixes = (CONTAINER_SUFFIX.source.match(/\(([^)]*)\)/)?.[1] ?? '').split('|');
            expect(suffixes.length).toBeGreaterThan(20);
            const names = [...CONTAINER_NAMES as Set<string>, ...JSON_COLUMN_NAMES as Set<string>, ...suffixes.map((word: string) => `x${word}`)];
            expect(names.length).toBeGreaterThan(100);
            for (const name of names) expect(data(`{ ${name}: row.${name} }`), name).toEqual(['unprojected-response']);
            // Control: a name in none of the three sources is a pick.
            expect(data('{ label: row.label }')).toEqual([]);
        });
        it('derives the JSON column names from the schema, so a new column is covered without editing the list', () => {
            const found = jsonColumnNamesIn("export const t = sqliteTable('t', { id: text('id'), note: text('note'), brandNewDoc: text('brand_new_doc', { mode: 'json' }).$type<X>(), flag: integer('flag', { mode: 'boolean' }) });") as Set<string>;
            expect([...found]).toEqual(['brandNewDoc']);
            for (const known of ['depositPolicy', 'lineItems', 'inspectionPrefs', 'attentionThresholds', 'capabilityOverrides', 'permissionOverrides', 'cancellationPolicy', 'ratingSystemSnapshot', 'samplingDeclaration', 'senderIdentity', 'termsAccepted', 'onboardingState', 'schema']) {
                expect((JSON_COLUMN_NAMES as Set<string>).has(known), known).toBe(true);
            }
            expect(data('{ depositPolicy: config?.depositPolicy ?? null }')).toEqual(['unprojected-response']);
        });
        it('counts an optional chain on a plain identifier as a pick, and a length on any receiver as a number', () => {
            expect(data('{ total: row?.total, n: a.b.length }')).toEqual([]);
        });
        it('is not a pick as a top-level key of the response', () => {
            for (const expr of ['row.data', 'row?.data', 'svc.get().data']) expect(data(expr), expr).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ inspection: row.inspection }, 200);'))).toEqual(['unprojected-response']);
            expect(rules(route('  return c.json({ id: row.id }, 200);'))).toEqual(['unprojected-response']);
        });
        it('is not a pick through a call, an await, a parenthesised expression or a longer path (scalar-looking names, so only the receiver rule can flag them)', () => {
            for (const expr of ['{ total: svc.get().total }', '{ total: (await svc.get()).total }', '{ total: (row).total }', '{ total: row.a.total }', '{ total: row?.a().total }']) {
                expect(data(expr), expr).toEqual(['unprojected-response']);
            }
            // Control: the same name from a plain identifier, and through an optional chain on one, is a pick.
            expect(data('{ total: row.total }')).toEqual([]);
            expect(data('{ total: row?.total }')).toEqual([]);
            // The name rule on its own: a container name from a plain identifier is refused whatever the receiver.
            expect(data('{ rows: row.rows }')).toEqual(['unprojected-response']);
        });
    });

    describe('a literal reached through a conditional, a map callback or a function of the file', () => {
        const data = (expr: string) => rules(route(`  return c.json({ success: true, data: ${expr} }, 200);`));
        it('reports a row held whole by any property, and accepts picked fields', () => {
            for (const expr of ['row ? { item: row } : null', 'rows.map((r) => ({ whole: r }))', 'rows.map((r) => ({ id: r.id, whole: r }))', 'row ? { ...row } : null']) {
                expect(data(expr), expr).toEqual(['unprojected-response']);
            }
            for (const expr of ['row ? { id: row.id } : null', 'rows.map((r) => ({ id: r.id, name: r.name }))', 'rows.map((r) => ({ id: r.id, total: Math.max(1, 2) }))']) {
                expect(data(expr), expr).toEqual([]);
            }
        });
        it('follows a function of the same file into the literal it returns', () => {
            const bad = 'function view(r) { return { item: r }; }' + NL + route('  return c.json({ data: view(row) }, 200);');
            expect(rules(bad)).toEqual(['unprojected-response']);
            const ok = 'function view(r) { return { id: r.id }; }' + NL + route('  return c.json({ data: view(row) }, 200);');
            expect(rules(ok)).toEqual([]);
        });
    });

    describe('a helper that answers with a value it is given', () => {
        it('is reported whatever it is called, when its value is returned', () => {
            for (const name of ['fail', 'created', 'jsonOk', 'whatever']) expect(rules(route(`  return ${name}(c, row);`)), name).toEqual(['unknown-response-helper']);
            expect(rules(route('  return await created(c, row);'))).toEqual(['unknown-response-helper']);
        });
        it('is not reported for a call whose value is not the answer, a known form, a declared function or a read of the request', () => {
            expect(rules(route('  await runGate(c, row);', '  return c.json({ data: null }, 200);'))).toEqual([]);
            expect(rules(route('  const db = getDrizzle(c, row);', '  return c.json({ data: null }, 200);'))).toEqual([]);
            expect(rules(route('  return getDrizzle(c, row);'))).toEqual([]);
            expect(rules('function created(c, v) { return c.json({ data: { id: v.id } }, 201); }' + NL + route('  return created(c, row);'))).toEqual([]);
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
        it('covers only the call it ends its line on, when one statement holds two responses', () => {
            const src = route('  return a', '    ? c.json({ data: row }, 200) // projection-allow: the first branch is a public listing', '    : c.json({ data: row }, 200);');
            expect(run(src).violations.map((v: Hit) => v.line)).toEqual([5]);
        });
        it('covers findings on its own line and the next only, never the rest of a multi-line response', () => {
            const first = ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({ // projection-allow: a flag written on this line only', '    ok: flag(),', '    data: row,', '  }, 200); });'].join(NL);
            const out = run(first).violations.map((v: { line: number; rule: string }) => `${v.line}:${v.rule}`);
            // The row on line 4 is reported; the marker on line 2 excuses nothing it sits on, so it is reported as unused, and `ok: flag()` on line 3 is reported too.
            expect(out).toEqual(expect.arrayContaining(['4:unprojected-response', '2:unused-projection-allow']));
            const second = ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({', '    ok: flag(), // projection-allow: a boolean flag', '    data: row,', '  }, 200); });'].join(NL);
            expect(run(second).violations.map((v: { line: number; rule: string }) => `${v.line}:${v.rule}`)).toEqual(['4:unprojected-response']);
            // A marker on the line above covers the next line, and not the line after it.
            const above = ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({', '    // projection-allow: a boolean flag', '    ok: flag(),', '    data: row,', '  }, 200); });'].join(NL);
            expect(run(above).violations.map((v: { line: number; rule: string }) => `${v.line}:${v.rule}`)).toEqual(['5:unprojected-response']);
        });
        const kinds = (src: string) => run(src).violations.map((v: { line: number; rule: string }) => `${v.line}:${v.rule}`);
        it('a blank line between a comment-only marker and the value: the marker is unused and the value is reported', () => {
            const src = ['app.get("/x", async (c) => { const row = await db.get();', '  // projection-allow: a comment-only marker covers the next line only', '', '  return c.json({ data: row }, 200); });'].join(NL);
            expect(kinds(src)).toEqual(expect.arrayContaining(['4:unprojected-response', '2:unused-projection-allow']));
        });
        it('a trailing marker on the line above does not cover the next line: the marker is unused and the value is reported', () => {
            const src = ['app.get("/x", async (c) => { const row = await db.get(); flag(); // projection-allow: a trailing marker covers its own line only', '  return c.json({ data: row }, 200); });'].join(NL);
            expect(kinds(src)).toEqual(expect.arrayContaining(['2:unprojected-response', '1:unused-projection-allow']));
        });
        it('one trailing marker covers every finding that starts on its line, and a value that starts there is covered however long it is', () => {
            expect(kinds(['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({ data: { a: f(row), b: g(row) } }, 200); // projection-allow: two scalars computed from named fields', '});'].join(NL))).toEqual([]);
            const long = ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({', '    data: { items: row.map((r) => ({', '      id: r.id,', '      whole: r,', '    })) }, // projection-allow: this marker is on the line the value ends on', '  }, 200); });'].join(NL);
            expect(kinds(long)).toEqual(expect.arrayContaining(['3:unprojected-response', '6:unused-projection-allow']));
            const startsHere = ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({', '    data: row.map((r) => ({ // projection-allow: a reviewed list built from named fields below', '      whole: r,', '    })),', '  }, 200); });'].join(NL);
            expect(kinds(startsHere)).toEqual([]);
        });
        it('pins the rule for a marker beside a finding of another kind', () => {
            // An unknown-response-helper finding on the marked line is excused and the marker is used.
            expect(kinds(['app.get("/x", async (c) => { const row = await db.get();', '  return fail(c, row); // projection-allow: fail answers with a fixed refusal body', '});'].join(NL))).toEqual([]);
            // A marker on a line with no finding is unused even when another line of the same response has one of another kind.
            const split = ['app.get("/x", async (c) => { const row = await db.get();', '  const ok = 1; // projection-allow: nothing on this line needs it', '  return fail(c, row);', '});'].join(NL);
            expect(kinds(split)).toEqual(expect.arrayContaining(['3:unknown-response-helper', '2:unused-projection-allow']));
        });
        it('reads markers from comments: text in a template literal is not one', () => {
            const src = ['app.get("/x", async (c) => { const row = await db.get(); const note = `', '// projection-allow: this is text inside a template literal, not a comment', '`;', '  return c.json({ data: row, note }, 200); });'].join(NL);
            expect(kinds(src)).toEqual(['4:unprojected-response']);
        });
        it('reports a marker that excuses nothing, and a marker with a short reason wherever it sits', () => {
            expect(rules(route('  // projection-allow: nothing here needs excusing', '  return c.json({ data: { id: row.id } }, 200);'))).toEqual(['unused-projection-allow']);
            expect(rules(route('  return c.json({ data: { id: row.id } }, 200); // projection-allow: ok'))).toEqual(['allow-without-reason']);
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
        expect(out).toMatch(/\d+ module\(s\) scanned, \d+ out of scope \| \d+ response\(s\) \| \d+ finding\(s\) vs \d+ baselined/);
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

    it('stops, rather than skips, a /api/public mount it cannot read', () => {
        const head = "import good from './api/good';" + NL + "import elsewhere from './features/elsewhere';" + NL + "import { viaPkg } from 'some-package';" + NL;
        expect(publicMounts(head + "app.route('/api/public', good);").map((m: { name: string }) => m.name)).toEqual(['good']);
        // Double-quoted, and the identifier is read like a single-quoted one.
        expect(publicMounts(head + 'app.route("/api/public", good);').map((m: { name: string }) => m.name)).toEqual(['good']);
        expect(() => publicMounts(head + "app.route('/api/public', elsewhere);")).toThrow(/not under \.\/api\//);
        expect(() => publicMounts(head + "app.route('/api/public', viaPkg);")).toThrow(/not a relative import/);
        expect(() => publicMounts(head + "app.route('/api/public', declaredHere);")).toThrow(/not a relative import/);
        expect(() => publicMounts(head + "app.route('/api/public', makeRoutes(env));")).toThrow(/could not parse/);
        // Control: a mount that is not under /api/public is not this check's business.
        expect(() => publicMounts(head + "app.route('/api/admin', elsewhere);")).not.toThrow();
    });

    it('resolves each unauthenticated path to the modules mounted at it, and notices one that no mount answers', () => {
        const { mounts } = parseMounts("import a from './api/a';" + NL + "import b from './api/b';" + NL + "import { onlyRoot } from './api/root-page';" + NL + "app.route('/api/open', a).route('/api/open/sub', b).route('/', onlyRoot);", 'server/index.ts');
        const paths = [
            "const x = path.startsWith('/api/open/') || path === '/api/open/exact' || path === '/page' || path.startsWith('/api/ghost/');",
            "// path.startsWith('/api/commented/')",
        ].join(NL);
        const { unresolved, modules, unlistedPages } = publicPathModules(paths, mounts, { pages: { '/page': 'a page' } });
        expect(unresolved).toEqual(['/api/ghost/']);
        expect(unlistedPages).toEqual([]);
        expect(modules.map((m: { mount: { name: string } }) => m.mount.name).sort()).toEqual(['a', 'b']);
    });

    it('reads an open path in any quote style, and stops on a form it cannot read', () => {
        const read = (text: string, constants = {}) => readOpenPaths(text, constants) as { literals: Array<{ path: string; prefix: boolean }>; problems: string[] };
        const quoted = read("a = path.startsWith('/a/') || path.startsWith(\"/b/\") || path.startsWith(`/c/`) || path === \"/d\" || path === `/e` || path === '/f';");
        expect(quoted.literals.map((l) => l.path).sort()).toEqual(['/a/', '/b/', '/c/', '/d', '/e', '/f']);
        expect(quoted.problems).toEqual([]);
        // A name is resolved through the constants; one that does not resolve is a problem, never a silent skip.
        expect(read('a = path === NAMED;', { NAMED: '/named' }).literals).toEqual([{ path: '/named', prefix: false }]);
        expect(read('a = path === NAMED;').problems.join()).toContain('NAMED');
        expect(read('a = path.startsWith(prefix);').problems.join()).toContain('startsWith( calls');
        expect(read("a = ['/x', '/y'].includes(path);").problems.join()).toContain('includes/has/indexOf');
        expect(read("a = path === '/x'; // path.startsWith('/commented/')").problems).toEqual([]);
        expect(readPathConstants("export const A = '/a';" + NL + 'export const B = `${A}/callback`;')).toEqual({ A: '/a', B: '/a/callback' });
    });

    it('requires an open path outside /api that no mount answers to be listed as a page, and a listed page to be open', () => {
        const mounts: never[] = [];
        const src = "a = path === '/page' || path === '/other';";
        const r = publicPathModules(src, mounts, { pages: { '/page': 'a page', '/gone': 'no longer open' } });
        expect(r.unlistedPages).toEqual(['/other']);
        expect(r.stalePages).toEqual(['/gone']);
        expect(publicPathModules(src, mounts, { pages: { '/page': 'a', '/other': 'b' } }).unlistedPages).toEqual([]);
    });

    it('holds a module mounted at the root to the same rule', () => {
        const { mounts } = parseMounts("import root from './api/root-routes';" + NL + "app.route('/', root);", 'server/index.ts');
        const r = publicPathModules("a = path === '/x';", mounts, { pages: { '/x': 'a page' } });
        expect(r.rootModules.map((m: { mount: { target: string } }) => m.mount.target)).toEqual(['server/api/root-routes']);
    });

    it('lists every page path with a reason', () => {
        for (const [path, reason] of Object.entries(PAGE_PATHS)) expect((reason as string).length, path).toBeGreaterThan(10);
    });

    it('lists out-of-scope modules with a reason, and none of them is also scanned', () => {
        expect(Object.keys(OUT_OF_SCOPE).length).toBeGreaterThan(0);
        for (const [file, reason] of Object.entries(OUT_OF_SCOPE)) expect((reason as string).length, file).toBeGreaterThan(10);
        expect(Object.keys(OUT_OF_SCOPE)).not.toContain('server/api/client.ts');
        expect(PUBLIC_MODULES).toContain(':(glob)server/api/client.ts');
    });

    it('reads the real mounts: every unauthenticated /api path resolves to a module that is scanned or out of scope', () => {
        const all = ['server/index.ts', 'server/portal/integration.module.ts'].flatMap((f) => {
            const r = parseMounts(readFileSync(f, 'utf8'), f);
            expect(r.problems, f).toEqual([]);
            return r.mounts;
        });
        const constants = readPathConstants(readFileSync('server/lib/qbo-oauth-paths.ts', 'utf8'));
        for (const m of all) if (m.path === null && m.pathName !== null) m.path = constants[m.pathName] ?? null;
        const open = publicPathModules(readFileSync('server/lib/auth/public-paths.ts', 'utf8'), all, { constants });
        expect(open.problems).toEqual([]);
        expect(open.unresolved).toEqual([]);
        expect(open.unlistedPages).toEqual([]);
        expect(open.stalePages).toEqual([]);
        expect(open.rootModules.map((m: { mount: { name: string } }) => m.mount.name)).toEqual(expect.arrayContaining(['ssoRootRoutes', 'agentMagicLoginRedeemRoutes']));
        const paths = open.modules.map((m: { mount: { path: string } }) => m.mount.path);
        for (const must of ['/api/public', '/api/portal', '/api/client', '/api/platform', '/webhooks/stripe', '/api/integrations/qbo']) expect(paths, must).toContain(must);
    });

    it('runs from a symlinked path as it does from the real one', (ctx) => {
        // The entry-point guard compares real paths, so a link to the script still runs the gate.
        const dir = mkdtempSync(join(tmpdir(), 'pp-link-'));
        const link = join(dir, 'check.mjs');
        try {
            symlinkSync(join(process.cwd(), 'scripts/check-public-projection.mjs'), link);
        } catch {
            // The platform refuses to create a link without privileges; the skip is visible, and the plain-path run above still covers the guard.
            rmSync(dir, { recursive: true, force: true });
            ctx.skip();
            return;
        }
        try {
            const out = execFileSync(process.execPath, [link], { cwd: process.cwd(), encoding: 'utf8' });
            expect(out).toContain('[public-projection] OK');
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    }, 120_000);
});
