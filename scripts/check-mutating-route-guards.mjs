#!/usr/bin/env node
/**
 * Mutating-route guard gate.
 *
 * Every POST / PUT / PATCH / DELETE route under server/api (and the other files that
 * register HTTP routes) must name a guard on who may call it, or be listed, with a
 * category and a reason, in scripts/mutating-route-guard-allowlist.json.
 *
 * Why this exists: the checks that already run compare only routes that DECLARE a
 * capability (check-capability-declarations.mjs, authorization-surface.spec.ts) or
 * cover ANONYMOUS access (api-default-deny.spec.ts). A new write route with no role or
 * capability guard at all is invisible to every one of them: any signed-in user, an
 * agent or an office user included, could call it. The reader and the guard list are in
 * scripts/lib/mutating-route-guards.mjs.
 *
 * The gate fails on:
 *   - an unguarded route that is not in the allow-list (file:line METHOD path);
 *   - a STALE entry: listed, but no such route exists any more, or it is guarded now;
 *   - an entry with no known category or no reason;
 *   - growth: more entries than `maxEntries`. The ceiling only goes down.
 *
 * Both numbers print on every run (routes scanned, routes unguarded), because a gate
 * that scanned nothing reads exactly like a clean tree; zero routes is a failure.
 *
 * `--self-test` runs positive and negative controls over synthetic source and exits.
 *
 * console.* is intentional: this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CATEGORIES, judge, routeKey, scanSource, unguarded } from './lib/mutating-route-guards.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ALLOW_LIST = join(ROOT, 'scripts', 'mutating-route-guard-allowlist.json');

/** Directories and files that register HTTP routes (server/index.ts mounts them). */
const SCAN_ROOTS = ['server/api', 'server/portal', 'server/features', 'server/index.ts'];

function walk(path, out = []) {
    if (!existsSync(path)) return out;
    if (statSync(path).isFile()) {
        if (/\.ts$/.test(path) && !/\.(test|spec)\.ts$/.test(path)) out.push(path);
        return out;
    }
    for (const entry of readdirSync(path)) walk(join(path, entry), out);
    return out;
}

/** Scan the repo: every mutating route in every route-registering file. */
export function scanRepo(root = ROOT) {
    const files = SCAN_ROOTS.flatMap((r) => walk(join(root, r)));
    const routes = [];
    for (const file of files) {
        const text = readFileSync(file, 'utf8');
        // Cheap pre-filter: a file that registers no route cannot contribute one.
        if (!/createRoute\s*\(|\.\s*(post|put|patch|delete|on|openapi)\s*\(/.test(text)) continue;
        routes.push(...scanSource(text, relative(root, file).replace(/\\/g, '/')));
    }
    return { files, routes };
}

/**
 * The paths `registerReportAuthoringGuard(app)` guards at mount time, read from its own
 * source so the two cannot drift. Routes under /api/inspections that match are guarded by
 * the `editReports` capability although their file shows no middleware.
 */
function authoringGuardMatchers(root = ROOT) {
    const file = join(root, 'server/lib/inspection/report-authoring-guard.ts');
    const text = readFileSync(file, 'utf8');
    const grab = (name) => {
        const m = new RegExp(`const ${name}\\s*=\\s*\\[([\\s\\S]*?)\\]\\s*as const`).exec(text);
        return m ? [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]) : [];
    };
    const toRe = (pattern) => new RegExp(`^${pattern.split('/').map((s) => (s === '*' ? '.*' : s.startsWith(':') ? '[^/]+' : s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))).join('/')}$`);
    return [
        ...grab('AUTHORING_SUFFIXES').map((s) => toRe(`/api/inspections/:id/${s}`)),
        ...grab('AUTHORING_PATHS').map((p) => toRe(p)),
    ];
}

/** Mark routes the global report-authoring guard covers as guarded (capability editReports). */
export function applyMountGuards(routes, root = ROOT) {
    const matchers = authoringGuardMatchers(root);
    return routes.map((r) => {
        if (r.principal || r.method === 'GET') return r;
        const underInspections = r.file.startsWith('server/api/inspections');
        const full = underInspections ? `/api/inspections${r.path}` : r.path;
        const covered = matchers.some((re) => re.test(full));
        return covered ? { ...r, guards: [...r.guards, 'requireCapability'], principal: true, viaMount: 'report-authoring-guard' } : r;
    });
}

function loadAllowList() {
    return JSON.parse(readFileSync(ALLOW_LIST, 'utf8'));
}

function report(routes, allow) {
    const verdict = judge(routes, allow);
    const bad = [];
    for (const r of verdict.offenders) bad.push(`${r.file}:${r.line} ${r.method} ${r.path} has no principal guard (guards seen: ${r.guards.join(', ') || 'none'})`);
    for (const k of verdict.stale) bad.push(`stale allow-list entry, no unguarded route matches: ${k}`);
    for (const k of verdict.malformed) bad.push(`allow-list entry needs a known category and a reason: ${k}`);
    if (verdict.grown) bad.push(`allow-list has ${verdict.count} entries; ceiling maxEntries is ${verdict.max}. The ceiling may only go down.`);
    return { verdict, bad };
}

// ── self-test ────────────────────────────────────────────────────────────────

function selfTest() {
    const failures = [];
    const check = (name, ok) => { if (!ok) failures.push(name); };
    const guardedKeys = (src) => scanSource(src, 'f.ts').filter((r) => r.principal).map((r) => `${r.method} ${r.path}`);
    const bareKeys = (src) => unguarded(scanSource(src, 'f.ts')).map((r) => `${r.method} ${r.path}`);

    const BARE_CR = "const r = createRoute({ method: 'post', path: '/x', request: {} });";
    check('unguarded createRoute post is reported', bareKeys(BARE_CR).join() === 'POST /x');
    const GUARDED_CR = "const r = createRoute(withMcpMetadata({ method: 'post', path: '/x', middleware: [requireRole('owner')] as const }, { scopes: [] }));";
    check('the same createRoute with requireRole is not reported', bareKeys(GUARDED_CR).length === 0 && guardedKeys(GUARDED_CR).join() === 'POST /x');
    check('a GET is never a mutating route', scanSource("createRoute({ method: 'get', path: '/x' });", 'f.ts').length === 0);
    check('denyStaff alone does not make a route guarded', bareKeys("createRoute({ method: 'delete', path: '/y', middleware: [denyStaff] });").join() === 'DELETE /y');
    check('a nested "method" key is not read as the route method', bareKeys("createRoute({ method: 'put', path: '/z', request: { body: { method: 'get' } } });").join() === 'PUT /z');

    const BARE_CHAIN = "router.post('/a', async (c) => c.json({}));";
    check('unguarded chained post is reported', bareKeys(BARE_CHAIN).join() === 'POST /a');
    const GUARDED_CHAIN = "router.post('/a', requireCapability('x'), async (c) => c.json({}));";
    check('the same chained post with a guard is not reported', bareKeys(GUARDED_CHAIN).length === 0);
    check('a guard named only inside the handler does not count', bareKeys("router.patch('/a', async (c) => { requireRole('owner'); });").join() === 'PATCH /a');
    check('.delete(id) on a service is not a route', scanSource('await store.delete(id);', 'f.ts').length === 0);

    const USE = "router.use('*', requireRole('owner'));\nrouter.post('/a', async (c) => c.json({}));";
    check('a router-level .use guard covers the routes after it', bareKeys(USE).length === 0);
    const USE_AFTER = "router.post('/a', async (c) => c.json({}));\nrouter.use('*', requireRole('owner'));";
    check('a .use placed AFTER a route does not cover it', bareKeys(USE_AFTER).join() === 'POST /a');
    const USE_PREFIX = "r.use('/admin/*', requireRole('owner'));\nr.post('/admin/x', h);\nr.post('/other', h);";
    check('a prefix .use covers only paths under it', bareKeys(USE_PREFIX).join() === 'POST /other');
    check('a :param .use path matches a concrete segment', bareKeys("r.use('/:t/notices', portalSessionGuard);\nr.post('/acme/notices', h);").length === 0);
    check('a guard alias is resolved', bareKeys("const OWN = requireRole('owner');\nrouter.post('/a', OWN, h);").length === 0);
    check('a route const DEFINED before a .use but MOUNTED after it is covered (Hono runs middleware in registration order)', bareKeys("const r = createRoute({ method: 'post', path: '/a' });\nrouter.use('*', portalSessionGuard);\nconst x = router.openapi(r, async (c) => c.json({}));").length === 0);
    check('the same const mounted BEFORE the .use is not covered', bareKeys("const r = createRoute({ method: 'post', path: '/a' });\nconst x = router.openapi(r, async (c) => c.json({}));\nrouter.use('*', portalSessionGuard);").join() === 'POST /a');
    check('a guard invoked inside the handler counts', bareKeys("const r = createRoute({ method: 'post', path: '/a' });\nrouter.openapi(r, async (c) => { await requireRole('agent')(c, async () => {}); });").length === 0);
    check('an inline .openapi(withMcpMetadata({...})) route is read', bareKeys("router.openapi(withMcpMetadata({ method: 'put', path: '/p' }, { scopes: [] }), async (c) => c.json({}));").join() === 'PUT /p');
    check('a comment that names a guard is not a guard', bareKeys("// requireRole('owner')\nrouter.post('/a', h);").join() === 'POST /a');

    const routes = scanSource("router.post('/a', h);\nrouter.post('/b', requireRole('owner'), h);", 'f.ts');
    const ok = { maxEntries: 1, entries: { 'f.ts::POST /a': { category: 'public-by-design', reason: 'booking form, validated in handler' } } };
    check('an allow-listed unguarded route passes', (() => { const v = judge(routes, ok); return v.offenders.length === 0 && v.stale.length === 0 && !v.grown; })());
    check('an unlisted unguarded route is an offender', judge(routes, { maxEntries: 0, entries: {} }).offenders.length === 1);
    const stale = { maxEntries: 2, entries: { ...ok.entries, 'f.ts::POST /gone': { category: 'public-by-design', reason: 'no longer exists' } } };
    check('a stale entry (no such route) fails', judge(routes, stale).stale.join() === 'f.ts::POST /gone');
    const nowGuarded = { maxEntries: 2, entries: { ...ok.entries, 'f.ts::POST /b': { category: 'public-by-design', reason: 'but it is guarded now' } } };
    check('an entry for a route that is now guarded fails', judge(routes, nowGuarded).stale.join() === 'f.ts::POST /b');
    check('growth past maxEntries fails', judge(routes, { maxEntries: 0, entries: ok.entries }).grown === true);
    check('an unknown category fails', judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': { category: 'because', reason: 'a long enough reason' } } }).malformed.length === 1);
    check('an entry with no reason fails', judge(routes, { maxEntries: 1, entries: { 'f.ts::POST /a': { category: 'public-by-design', reason: '' } } }).malformed.length === 1);
    check('the category set is closed and non-empty', Object.keys(CATEGORIES).length >= 5);

    if (failures.length > 0) {
        console.error('Mutating-route guard gate self-test FAILED:');
        for (const f of failures) console.error(`  - ${f}`);
        process.exit(1);
    }
    console.log('Mutating-route guard gate self-test: OK (positive and negative controls pass).');
}

// ── main ─────────────────────────────────────────────────────────────────────

function main() {
    if (process.argv.includes('--self-test')) { selfTest(); return; }
    const { files, routes: raw } = scanRepo();
    const routes = applyMountGuards(raw);
    if (files.length === 0 || routes.length === 0) {
        console.error(`Mutating-route guard gate: scanned ${files.length} file(s) and found ${routes.length} mutating route(s). A scan that sees nothing is broken, not clean.`);
        process.exit(1);
    }
    const allow = loadAllowList();
    const { verdict, bad } = report(routes, allow);
    const open = unguarded(routes).length;
    console.log(`[mutating-route-guards] ${routes.length} mutating route(s) in ${files.length} file(s); ${open} without a principal guard, ${verdict.count}/${verdict.max} allow-listed.`);
    if (bad.length > 0) {
        console.error('\nMutating-route guard gate FAILED:\n');
        for (const b of bad) console.error(`  ${b}`);
        console.error(
            '\n  Add requireRole(...) or requireCapability(...) to the route, matching its siblings.\n' +
            '  If it is genuinely public, token-gated, a webhook or open to any signed-in user, add an entry\n' +
            '  to scripts/mutating-route-guard-allowlist.json with a category and a reason you verified in\n' +
            '  the handler. The list may only shrink: lower maxEntries when you remove one.\n',
        );
        process.exit(1);
    }
}

const isMain = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase().endsWith('check-mutating-route-guards.mjs');
if (isMain) main();

export { routeKey };
