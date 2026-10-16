/**
 * Every mutating route names a guard, or is listed with a reason.
 *
 * The reader lives in scripts/lib/mutating-route-guards.mjs and the gate in
 * scripts/check-mutating-route-guards.mjs. This spec pins the reader with synthetic
 * source (a positive and a negative control for each case), judges the real server tree
 * against the allow-list so CI fails even if the script is never run, and shows the scan
 * is not blind by removing a real file's guards and watching its routes turn up.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { scanSource, unguarded, judge, routeKey, CATEGORIES, useCovers } from '../../../scripts/lib/mutating-route-guards.mjs';
// @ts-expect-error -- plain .mjs helper, no types alongside it (same as the other tooling specs).
import { scanRepo, applyMountGuards } from '../../../scripts/check-mutating-route-guards.mjs';

/** The fields of a scanned route this spec reads; the scanner itself is untyped JavaScript. */
interface RouteRef { file?: string; line?: number; method: string; path: string }

const ROOT = path.resolve(__dirname, '../../..');
const ALLOW = JSON.parse(readFileSync(path.join(ROOT, 'scripts/mutating-route-guard-allowlist.json'), 'utf8')) as {
    maxEntries: number;
    entries: Record<string, { category: string; reason: string }>;
};

const bare = (src: string) => unguarded(scanSource(src, 'f.ts')).map((r: RouteRef) => `${r.method} ${r.path}`);

describe('scanSource: createRoute style', () => {
    const CR = (mw = '') => `const r = createRoute(withMcpMetadata({ method: 'post', path: '/x', ${mw} request: {} }, { scopes: [] }));`;

    it('reports a mutating route with no guard', () => expect(bare(CR())).toEqual(['POST /x']));
    it('POSITIVE CONTROL - the same route with requireRole is not reported', () => expect(bare(CR("middleware: [requireRole('owner')] as const,"))).toEqual([]));
    it('requireCapability counts', () => expect(bare(CR("middleware: [requireRole('owner'), requireCapability('publish')],"))).toEqual([]));
    it('denyStaff alone is a narrowing guard, not a principal one', () => expect(bare(CR('middleware: [denyStaff],'))).toEqual(['POST /x']));
    it('reads put, patch and delete, and never a get', () => {
        for (const m of ['put', 'patch', 'delete']) expect(bare(`createRoute({ method: '${m}', path: '/y' });`)).toEqual([`${m.toUpperCase()} /y`]);
        expect(scanSource("createRoute({ method: 'get', path: '/y' });", 'f.ts')).toEqual([]);
    });
    it('does not mistake a nested method key for the route method', () => {
        expect(bare("createRoute({ method: 'put', path: '/z', request: { body: { method: 'get' } } });")).toEqual(['PUT /z']);
    });
    it('resolves a middleware list held in a const', () => {
        expect(bare("const GUARDS = [requireRole('owner')] as const;\ncreateRoute({ method: 'post', path: '/g', middleware: GUARDS });")).toEqual([]);
    });
    it('reads an inline .openapi(withMcpMetadata({...})) route', () => {
        expect(bare("r.openapi(withMcpMetadata({ method: 'put', path: '/p' }, { scopes: [] }), async (c) => c.json({}));")).toEqual(['PUT /p']);
        expect(bare("r.openapi(withMcpMetadata({ method: 'put', path: '/p', middleware: [requireRole('owner')] }, { scopes: [] }), h);")).toEqual([]);
    });
});

describe('scanSource: plain Hono style', () => {
    it('reports an unguarded chained post, and not one with a guard', () => {
        expect(bare("router.post('/a', async (c) => c.json({}));")).toEqual(['POST /a']);
        expect(bare("router.post('/a', requireCapability('x'), async (c) => c.json({}));")).toEqual([]);
    });
    it('a guard named only inside the handler body does not count', () => {
        expect(bare("router.patch('/a', async (c) => { const x = 'requireRole'; });")).toEqual(['PATCH /a']);
    });
    it('a guard INVOKED inside the handler counts', () => {
        expect(bare("router.post('/a', async (c) => { await requireRole('agent')(c, async () => {}); });")).toEqual([]);
    });
    it('reads app.on(...) with a method list', () => {
        expect(bare("app.on(['POST', 'GET'], '/o', async (c) => c.json({}));")).toEqual(['POST /o']);
    });
    it('.delete(id) on a store is not a route', () => expect(scanSource('await store.delete(id);', 'f.ts')).toEqual([]));
    it('a comment that names a guard is not a guard', () => expect(bare("// requireRole('owner')\nrouter.post('/a', h);")).toEqual(['POST /a']));
});

describe('router-level .use guards', () => {
    it('cover the routes registered after them', () => {
        expect(bare("router.use('*', requireRole('owner'));\nrouter.post('/a', h);")).toEqual([]);
    });
    it('CONTROL - do not cover a route registered before them', () => {
        expect(bare("router.post('/a', h);\nrouter.use('*', requireRole('owner'));")).toEqual(['POST /a']);
    });
    it('cover only the paths under their prefix', () => {
        expect(bare("r.use('/admin/*', requireRole('owner'));\nr.post('/admin/x', h);\nr.post('/other', h);")).toEqual(['POST /other']);
    });
    it('treat a :param segment as a wildcard', () => {
        expect(useCovers('/:t/notices', '/acme/notices')).toBe(true);
        expect(useCovers('/:t/notices', '/acme/other')).toBe(false);
    });
    it('count where a createRoute const is MOUNTED, not where it is defined', () => {
        const defined = "const r = createRoute({ method: 'post', path: '/a' });\n";
        expect(bare(`${defined}router.use('*', portalSessionGuard);\nrouter.openapi(r, h);`)).toEqual([]);
        expect(bare(`${defined}router.openapi(r, h);\nrouter.use('*', portalSessionGuard);`)).toEqual(['POST /a']);
    });
});

describe('judge: the allow-list', () => {
    const routes = scanSource("router.post('/a', h);\nrouter.post('/b', requireRole('owner'), h);", 'f.ts');
    const entry = { category: 'public-by-design', reason: 'booking form, validated in the handler' };

    it('lets a listed unguarded route pass', () => {
        const v = judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': entry } });
        expect([v.offenders.length, v.stale.length, v.malformed.length, v.grown]).toEqual([0, 0, 0, false]);
    });
    it('POSITIVE CONTROL - an unlisted unguarded route is an offender, named by file and path', () => {
        const v = judge(routes, { maxEntries: 0, entries: {} });
        expect(v.offenders.map(routeKey)).toEqual(['f.ts::POST /a']);
    });
    it('fails a stale entry, and an entry for a route that is guarded now', () => {
        const stale = judge(routes, { maxEntries: 3, entries: { 'f.ts::POST /a': entry, 'f.ts::POST /gone': entry, 'f.ts::POST /b': entry } });
        expect(stale.stale.sort()).toEqual(['f.ts::POST /b', 'f.ts::POST /gone']);
    });
    it('fails growth past maxEntries', () => {
        expect(judge(routes, { maxEntries: 0, entries: { 'f.ts::POST /a': entry } }).grown).toBe(true);
        expect(judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': entry } }).grown).toBe(false);
    });
    it('fails an unknown category and a missing reason', () => {
        expect(judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': { category: 'because', reason: 'a long enough reason' } } }).malformed).toHaveLength(1);
        expect(judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': { category: 'public-by-design', reason: '' } } }).malformed).toHaveLength(1);
    });
});

describe('the real server tree', () => {
    const { files, routes: raw } = scanRepo(ROOT);
    const routes = applyMountGuards(raw, ROOT);

    it('is read, not an empty walk (both numbers printed)', () => {
        // eslint-disable-next-line no-console
        console.log(`[mutating-route-guards] files=${files.length} routes=${routes.length} unguarded=${unguarded(routes).length} allowListed=${Object.keys(ALLOW.entries).length}/${ALLOW.maxEntries}`);
        expect(files.length).toBeGreaterThan(150);
        expect(routes.length).toBeGreaterThan(300);
    });

    it('has no mutating route without a guard that is not allow-listed', () => {
        const v = judge(routes, ALLOW);
        expect(v.offenders.map((r: RouteRef) => `${r.file}:${r.line} ${r.method} ${r.path}`)).toEqual([]);
        expect(v.stale).toEqual([]);
        expect(v.malformed).toEqual([]);
        expect(v.grown).toBe(false);
    });

    it('lists every entry under a category the module defines', () => {
        for (const e of Object.values(ALLOW.entries)) expect(Object.keys(CATEGORIES)).toContain(e.category);
    });

    it('is not blind: removing the guards from a real file makes its routes turn up, and the real file has none', () => {
        const file = 'server/api/inspections/cancellation.ts';
        const text = readFileSync(path.join(ROOT, file), 'utf8');
        expect(unguarded(scanSource(text, file))).toEqual([]);
        const stripped = text.replace(/requireRole\(/g, 'allowAnyone(').replace(/requireCapability\(/g, 'allowAnyone(').replace(/guardStaffUncancel/g, 'allowAnyone');
        expect(unguarded(scanSource(stripped, file)).length).toBeGreaterThanOrEqual(2);
    });

    it('sees every route file under server/api (nothing registers routes in a directory the scan skips)', () => {
        const dirs = new Set<string>();
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const p = path.join(dir, name);
                if (statSync(p).isDirectory()) walk(p);
                else if (/\.ts$/.test(name) && !/\.(test|spec)\.ts$/.test(name)
                    && /createRoute\s*\(|\.\s*(post|put|patch|delete)\s*\(\s*['"][/*]|\.\s*openapi\s*\(/.test(readFileSync(p, 'utf8'))) dirs.add(path.relative(ROOT, p).split(path.sep).join('/'));
            }
        };
        walk(path.join(ROOT, 'server/api'));
        const scanned = new Set(files.map((f: string) => path.relative(ROOT, f).split(path.sep).join('/')));
        expect([...dirs].filter((f) => !scanned.has(f))).toEqual([]);
    });
});
