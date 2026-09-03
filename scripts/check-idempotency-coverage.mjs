#!/usr/bin/env node
/**
 * scripts/check-idempotency-coverage.mjs
 *
 * Retry safety is invisible at the call site: a mutating route with no
 * idempotency story looks identical to a guarded one — every request gets a
 * sensible response, and the duplicate row only shows up when a customer's
 * network retries a POST. The middleware (`app.use('*', idempotencyGuard)` in
 * server/index.ts, mounted AFTER the JWT middleware) covers a route ONLY when a
 * tenant is on the context when it runs AND the client sends an
 * `Idempotency-Key`; a request with no tenant passes through unguarded by
 * design, because a bare key would be a global namespace two tenants could
 * collide in.
 *
 * So this gate keeps a ledger. Every mutating route it discovers must be one of:
 *
 *   verified   := the route is in the table the suite drives
 *                 (tests/unit/idempotency/route-coverage.spec.ts, fed by THIS
 *                 script's `collect()` — one walk, one source of paths).
 *   byDesign   := no tenant reaches it IN SAAS, or it owns its dedup —
 *                 hand-classified, reason required. ⚠️ In standalone
 *                 resolveByFixedTenant stamps a tenant on every request, so
 *                 these routes ARE guarded there; this table does not describe
 *                 that mode.
 *   excluded   := the table cannot drive it — `tableExclusions`, reason
 *                 required.
 *   unreachable:= permanently 401 / not mounted; printed on every run, never
 *                 silently forgotten.
 *   pending    := residual. MUST be empty.
 *
 * ⚠️ THIS GATE ASSERTS COVERAGE, NOT CORRECT REPLAY. The table proves the guard
 * is mounted ahead of each route and claims a key when a tenant is on the
 * context. It does NOT prove that a replay returns the stored response — that
 * needs a business-valid body per route, which is the expensive part and the
 * reason this exists. The surviving end-to-end replay specs remain the proof
 * that the mechanism works through a real route. A future reader must not
 * mistake the weaker guarantee for the stronger one. The JWT layer is STUBBED
 * in the suite, so tenant PRESENCE is assumed, not proved; `uncoveredByDesign`
 * is where that judgement lives.
 *
 * WHY THE EVIDENCE IS A WIRING CHECK AND NOT A HANDSHAKE. The obvious design is
 * an artifact handshake: the suite writes a JSON of the routes it drove and the
 * gate reads it. That does NOT work here — CI runs `lint` BEFORE `test:unit`
 * (.github/workflows/ci.yml), so on every clean checkout the gate would read a
 * stale or missing artifact. Instead the gate verifies the WIRING: the suite
 * file exists and imports `collect` from this very script, so the two cannot
 * drift apart on which routes exist. This is weaker than a handshake and the
 * reader should know which one they have: it proves the suite walks the same
 * surface, not that the suite passed.
 *
 * DISCOVERY LIMITS, stated rather than left to be discovered:
 *   - Only `server/api/**` is walked, reached from the `.route()` mounts in
 *     server/index.ts and followed recursively through sub-router mounts.
 *     A router that server/index.ts never mounts is invisible here.
 *   - Routes registered INLINE in server/index.ts (`app.post(...)` written in
 *     that file rather than in a sub-router) are outside the walk.
 *   - Routes registered through a helper function whose first parameter is
 *     named `router` (`registerR2VideoRoutes(mediaStudioRoutes)`) are followed,
 *     but only when the call is a bare top-level `registerX(someRouter);`
 *     statement. A helper called conditionally, or with a router built inline,
 *     is invisible.
 *   - A router's chain body runs from the `const X = createApiRouter()` line to
 *     the next TOP-LEVEL STATEMENT (`const`/`export`/`function`/…), not to the
 *     next line at column zero: several modules close a registration with a
 *     column-zero `}, { scopes: [...] })), async (c) => {`, and the old
 *     column-zero rule cut those chains off after their first route.
 *
 * THE COUNTERS ARE THE GATE, not a footnote. `declaredMutating` is a raw,
 * parser-independent scan of the source for mutating route declarations, keyed
 * by `<file>:<line>`; `resolvedMutating` is how many of those exact sites the
 * walk placed on a full path. **They must be equal, and the gate fails when
 * they are not.** For months they sat side by side in the baseline reading 316
 * and 306, and that difference of 10 was the precise number of routes the
 * parser could not see — inline `.openapi(createRoute({...}))` registrations it
 * silently dropped, including three money-moving `/services` routes that
 * appeared in no list at all. A counter that reports a hole without failing is
 * a note. A route form this parser does not understand must turn the gate RED,
 * not quietly shrink its coverage.
 *
 * Usage:
 *   node scripts/check-idempotency-coverage.mjs            # verify (exit 1 on drift)
 *   node scripts/check-idempotency-coverage.mjs --update   # regenerate `pending`
 *
 * Exit 0 = OK; exit 1 = drift, or zero routes parsed (fails closed).
 */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname, resolve as resolvePath, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const API_DIR = join(ROOT, 'server/api');
const INDEX_FILE = join(ROOT, 'server/index.ts');
const REPLAY_SPEC_DIR = join(ROOT, 'tests/unit/idempotency');
const APP_DIR = join(ROOT, 'app');
const BASELINE_PATH = join(__dirname, 'idempotency-baseline.json');

const MUTATING = new Set(['post', 'put', 'patch', 'delete']);

function read(path) {
    return readFileSync(path, 'utf8');
}

/** Blank comments out rather than removing them, so line numbers hold. */
function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/\/\/[^\n]*/g, '');
}

/** Every `.ts` under `dir`, recursively, as paths relative to `dir`. */
function walkTs(dir, prefix = '') {
    const out = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) out.push(...walkTs(join(dir, entry.name), rel));
        else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) out.push(rel);
    }
    return out;
}

function countNewlines(s) {
    return (s.match(/\n/g) ?? []).length;
}

/**
 * A DECLARATION SITE: `<file relative to server/api>:<1-based line>` of the line
 * that declares a mutating route — the `method: 'post'` of a createRoute object,
 * or the `.post('/path'` of an inline verb registration. It is the join key
 * between the two counters: the raw source tally (below, deliberately parser-
 * independent) and the set of sites the walk actually resolved to a full path.
 * Line-keyed rather than name-keyed because an INLINE route has no name.
 */
const DECL_METHOD_RE = /\bmethod:\s*'(?:post|put|patch|delete)'/;
const DECL_VERB_RE = /\.(?:post|put|patch|delete)\(\s*'\//;

/**
 * The start of a new top-level statement — the terminator for a declaration's
 * block. NOT "any line starting at column zero": several route modules close an
 * `.openapi(createRoute(withMcpMetadata({…}` registration with a column-zero
 * `}, { scopes: […] })), async (c) => {` and a column-zero `})`, so the naive
 * rule cut the chain off after its FIRST route and every registration below was
 * invisible — five in marketplace.ts, two in inspection-sync.ts. A closing
 * brace continues the expression; a `const`/`export`/`function` starts a new one.
 */
const TOP_LEVEL_RE = /^(?:export|const|let|var|function|async\s+function|class|type|interface|enum|declare|import)\b/;

/** Lines `i..end` of a declaration, as one string; `end` is the last line before the next top-level statement. */
function blockFrom(lines, i) {
    let last = i;
    for (let j = i + 1; j < lines.length && !TOP_LEVEL_RE.test(lines[j]); j++) last = j;
    return lines.slice(i, last + 1).join('\n');
}

function joinPaths(prefix, path) {
    return (prefix + path).replace(/\/{2,}/g, '/').replace(/(.)\/$/, '$1');
}

/**
 * Resolve a relative import specifier from `fromFile` (a path relative to
 * API_DIR, or null for server/index.ts) to a file relative to API_DIR.
 * Returns null when the target is outside server/api.
 */
function resolveImport(fromRel, spec) {
    if (!spec.startsWith('.')) return null;
    const baseDir = fromRel === null ? join(ROOT, 'server') : dirname(join(API_DIR, fromRel));
    const abs = resolvePath(baseDir, spec);
    for (const candidate of [`${abs}.ts`, join(abs, 'index.ts')]) {
        if (!existsSync(candidate)) continue;
        const rel = relative(API_DIR, candidate).split('\\').join('/');
        if (rel.startsWith('..')) return null;
        return rel;
    }
    return null;
}

/** local ident -> { file, exported } where `exported` is a name or 'default'. */
function parseImports(src, fromRel) {
    const map = new Map();
    for (const m of src.matchAll(/import\s+([^;]+?)\s+from\s+'([^']+)'/g)) {
        const clause = m[1];
        const file = resolveImport(fromRel, m[2]);
        if (!file) continue;
        const defaultMatch = clause.match(/^\s*(\w+)/);
        if (defaultMatch) map.set(defaultMatch[1], { file, exported: 'default' });
        const named = clause.match(/\{([\s\S]*)\}/);
        if (named) {
            for (const part of named[1].split(',')) {
                const t = part.trim();
                if (!t) continue;
                const as = t.match(/^(\w+)\s+as\s+(\w+)$/);
                if (as) map.set(as[2], { file, exported: as[1] });
                else if (/^\w+$/.test(t)) map.set(t, { file, exported: t });
            }
        }
    }
    return map;
}

/**
 * `const NAME = createRoute(...)` declarations, keyed by const name. OI wraps
 * most of them in `withMcpMetadata({...})`, so the body is read from the
 * declaration up to the next top-level `const`/`export`/`function` line rather
 * than by matching a fixed closing shape.
 */
function parseRouteConsts(src) {
    const lines = src.split('\n');
    const out = new Map();
    for (let i = 0; i < lines.length; i++) {
        // `const X = createRoute(…)` and `const X = withMcpMetadata(createRoute(…))`
        // are the same declaration wearing different wrappers; inspection-prefs.ts
        // uses the second and its PATCH route was invisible for it.
        const decl = lines[i].match(/^(?:export )?const (\w+)(?::[^=]+)? = (?:\w+\()*createRoute\(/);
        if (!decl) continue;
        const body = blockFrom(lines, i);
        const m = body.match(/\bmethod:\s*'(\w+)'/);
        const path = body.match(/\bpath:\s*'([^']*)'/)?.[1];
        if (!m || path === undefined) continue;
        out.set(decl[1], { method: m[1], path, line: i + 1 + countNewlines(body.slice(0, m.index)) });
    }
    return out;
}

/**
 * Routers declared in one file: for each, the route consts it chains via
 * `.openapi()`, the verbs it registers inline, and the sub-routers it mounts.
 * Two registration shapes are read — the chain that follows the declaration
 * (delimited by indentation) and later `IDENT.verb(...)` / `IDENT.route(...)`
 * statements written against the same ident.
 */
function parseRouters(src) {
    const lines = src.split('\n');
    const routers = new Map();
    const ensure = (name) => {
        if (!routers.has(name)) routers.set(name, { routeConsts: [], chained: [], mounts: [] });
        return routers.get(name);
    };

    /**
     * `baseLine` is the 1-based file line of `body`'s first line, so every route
     * harvested out of a substring still carries the declaration site it came
     * from. Without it an inline route could be seen but not attributed, and the
     * declared-vs-resolved reconciliation below would have nothing to join on.
     */
    const harvest = (target, body, baseLine) => {
        // Two registration shapes, told apart by what follows the ident:
        //   `.openapi(NAME, handler)`            → a named const, resolved later
        //                                          via the const/import tables.
        //   `.openapi(FACTORY({ … }), handler)`  → the route object is written
        //                                          INLINE; there is no const to
        //                                          look up, so method+path are
        //                                          read from the literal here.
        // The discriminator is the trailing `(` — a CALL — not the callee's
        // name. Matching on the name `createRoute` would go blind again the day
        // someone wraps it, and the old `.openapi(\s*(\w+)` captured the literal
        // word `createRoute` as if it were a const, found no declaration, and
        // dropped the route in silence.
        const opens = [...body.matchAll(/\.openapi\(\s*(\w+)\s*(\()?/g)];
        for (let k = 0; k < opens.length; k++) {
            const m = opens[k];
            if (!m[2]) {
                target.routeConsts.push(m[1]);
                continue;
            }
            // The inline object runs until the next registration in the chain.
            const stop = k + 1 < opens.length ? opens[k + 1].index : body.length;
            const chunk = body.slice(m.index, stop);
            const method = chunk.match(/\bmethod:\s*'(\w+)'/);
            const path = chunk.match(/\bpath:\s*'([^']*)'/)?.[1];
            if (!method || path === undefined) continue;
            target.chained.push({
                method: method[1],
                path,
                line: baseLine + countNewlines(body.slice(0, m.index + method.index)),
            });
        }
        for (const m of body.matchAll(/\.route\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
            target.mounts.push({ prefix: m[1], ident: m[2] });
        }
        // The leading `/` separates a route registration from an unrelated
        // method call (`ALLOWED.delete('x')`, `map.get('k')`).
        for (const m of body.matchAll(/\.(post|put|patch|delete|get)\(\s*'(\/[^']*)'/g)) {
            target.chained.push({
                method: m[1],
                path: m[2],
                line: baseLine + countNewlines(body.slice(0, m.index)),
            });
        }
    };

    const bodyFrom = (i) => blockFrom(lines, i);

    for (let i = 0; i < lines.length; i++) {
        const decl = lines[i].match(/^(?:export )?const (\w+)(?::[^=]+)? = (?:createApiRouter\(|new (?:OpenAPIHono|Hono))/);
        if (!decl) continue;
        harvest(ensure(decl[1]), bodyFrom(i), i + 1);
    }

    // Alias chains: `const base = createApiRouter();` followed by
    // `const exported = base.openapi(...)...` — portal.ts and the notice
    // modules split the declaration from the chain that way, and reading only
    // the factory line would resolve those routers to nothing.
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < lines.length; i++) {
            const decl = lines[i].match(/^(?:export )?const (\w+)(?::[^=]+)? = (\w+)\s*$/);
            if (!decl || routers.has(decl[1]) || !routers.has(decl[2])) continue;
            const target = ensure(decl[1]);
            const base = routers.get(decl[2]);
            target.routeConsts.push(...base.routeConsts);
            target.chained.push(...base.chained);
            target.mounts.push(...base.mounts);
            harvest(target, bodyFrom(i), i + 1);
        }
    }

    // Statements written against the ident after the declaration:
    // `clientMessageRoutes.post('/inspections/:id/messages', …)`.
    for (const name of [...routers.keys()]) {
        const stmt = new RegExp(`^${name}\\s*\\n?\\s*\\.[\\s\\S]*?(?=\\n\\S|$)`, 'gm');
        for (const m of src.matchAll(stmt)) {
            harvest(routers.get(name), m[0], countNewlines(src.slice(0, m.index)) + 1);
        }
    }

    return routers;
}

/**
 * `export function registerX(router, …) { router.post('/p', …) }` — a helper
 * that takes a router and registers on it. Keyed by function name; the call
 * site decides which router (and therefore which prefix) they land on.
 */
function parseRouterHelpers(src) {
    const lines = src.split('\n');
    const out = new Map();
    for (let i = 0; i < lines.length; i++) {
        const decl = lines[i].match(/^export function (\w+)\(\s*router\b/);
        if (!decl) continue;
        const body = `\n${blockFrom(lines, i + 1)}`;
        // `body` starts with a leading "\n", so its first character sits on the
        // helper's declaration line: baseLine is that line, 1-based.
        const chained = [...body.matchAll(/\brouter\.(post|put|patch|delete|get)\(\s*'(\/[^']*)'/g)]
            .map(m => ({
                method: m[1],
                path: m[2],
                line: i + 1 + countNewlines(body.slice(0, m.index)),
            }));
        out.set(decl[1], chained);
    }
    return out;
}

/** `registerX(someRouter);` call sites — helper name paired with the router ident. */
function parseHelperCalls(src) {
    return [...src.matchAll(/^(\w+)\(\s*(\w+)\s*\);/gm)].map(m => ({ fn: m[1], ident: m[2] }));
}

/** `export default someRouter;` — the local name behind a default import. */
function parseDefaultExport(src) {
    return src.match(/^export default (\w+);/m)?.[1] ?? null;
}

/**
 * The route walk, EXPORTED so the table-driven suite
 * (tests/unit/idempotency/route-coverage.spec.ts) drives exactly the routes
 * this gate classifies. One walk, one source of paths — an artifact handshake
 * between the two would go stale, because CI runs `lint` before `test:unit`.
 */
export { collect };

function collect() {
    const files = walkTs(API_DIR);
    const parsed = new Map();
    /** declaration site -> the source line that declares it. */
    const declSites = new Map();

    for (const f of files) {
        const src = stripComments(read(join(API_DIR, f)));
        // Declared-side tally: every mutating createRoute + every inline
        // mutating verb with a quoted path, recorded BY SITE rather than as a
        // bare count. This scan is deliberately independent of the parser —
        // a parser that quietly sees less than the surface reports OK either
        // way, so the surface has to be measured without it. Every site here
        // must come back resolved; see the reconciliation in main().
        src.split('\n').forEach((text, i) => {
            if (!DECL_METHOD_RE.test(text) && !DECL_VERB_RE.test(text)) return;
            declSites.set(`${f}:${i + 1}`, text.trim());
        });
        parsed.set(f, {
            imports: parseImports(src, f),
            consts: parseRouteConsts(src),
            routers: parseRouters(src),
            helpers: parseRouterHelpers(src),
            helperCalls: parseHelperCalls(src),
            defaultExport: parseDefaultExport(src),
        });
    }

    const indexSrc = stripComments(read(INDEX_FILE));
    const indexImports = parseImports(indexSrc, null);

    const routes = [];
    const seen = new Set();
    /** Declaration sites the walk placed on a full path. */
    const resolvedSites = new Set();
    const push = (method, fullPath, file, site) => {
        if (!MUTATING.has(method)) return;
        // Marked resolved even when the path is a duplicate: a dual-mounted
        // router (stripeWebhookRoutes, at `/webhooks/stripe/:tenant` and at
        // `/webhooks/stripe`) resolves ONE declaration to two paths; a router
        // reached twice resolves it to the same path twice. Either way it landed.
        resolvedSites.add(site);
        const route = `${method.toUpperCase()} ${fullPath}`;
        if (seen.has(route)) return;
        seen.add(route);
        routes.push({ route, file });
    };

    /** Follow one router ident inside one file, accumulating full paths. */
    const visit = (file, routerName, prefix, stack) => {
        const entry = parsed.get(file);
        if (!entry) return;
        const router = entry.routers.get(routerName);
        if (!router) return;
        const key = `${file}#${routerName}#${prefix}`;
        if (stack.has(key)) return;
        stack.add(key);

        for (const constName of router.routeConsts) {
            // Same-file consts win; route-const names collide across modules
            // (several files declare `deleteRoute`), so the import table is
            // consulted before any global lookup.
            const imported = entry.imports.get(constName);
            const own = entry.consts.get(constName);
            const rc = own ?? (imported ? parsed.get(imported.file)?.consts.get(imported.exported) : undefined);
            if (!rc) continue;
            push(rc.method, joinPaths(prefix, rc.path), file, `${own ? file : imported.file}:${rc.line}`);
        }
        for (const { method, path, line } of router.chained) {
            push(method, joinPaths(prefix, path), file, `${file}:${line}`);
        }
        // Helper-registered verbs land on the router the helper was called with.
        for (const { fn, ident } of entry.helperCalls) {
            if (ident !== routerName) continue;
            const imported = entry.imports.get(fn);
            const source = imported ? parsed.get(imported.file) : entry;
            const chained = source?.helpers.get(imported ? imported.exported : fn);
            if (!chained) continue;
            const declFile = imported ? imported.file : file;
            for (const { method, path, line } of chained) {
                push(method, joinPaths(prefix, path), declFile, `${declFile}:${line}`);
            }
        }
        for (const { prefix: sub, ident } of router.mounts) {
            const target = resolveRouter(entry, file, ident);
            if (!target) continue;
            visit(target.file, target.name, joinPaths(prefix, sub), stack);
        }
    };

    /** An ident used in a mount → the file + local router name it names. */
    function resolveRouter(entry, file, ident) {
        if (entry.routers.has(ident)) return { file, name: ident };
        const imported = entry.imports.get(ident);
        if (!imported) return null;
        const target = parsed.get(imported.file);
        if (!target) return null;
        const name = imported.exported === 'default' ? target.defaultExport : imported.exported;
        if (!name || !target.routers.has(name)) return null;
        return { file: imported.file, name };
    }

    for (const m of indexSrc.matchAll(/\.route\(\s*'([^']*)'\s*,\s*(\w+)\s*[),]/g)) {
        const [, prefix, ident] = m;
        const imported = indexImports.get(ident);
        if (!imported) continue;
        const target = parsed.get(imported.file);
        if (!target) continue;
        const name = imported.exported === 'default' ? target.defaultExport : imported.exported;
        if (!name) continue;
        visit(imported.file, name, prefix, new Set());
    }

    // Reconciliation. `resolvedSites` is a subset of `declSites` by
    // construction (the parser reads method/path with the same patterns the raw
    // scan uses), so the difference is exactly the surface the walk cannot see.
    const unresolved = [...declSites.keys()]
        .filter(site => !resolvedSites.has(site))
        .map(site => ({ site, text: declSites.get(site) }));

    return Object.assign(routes, {
        declaredMutating: declSites.size,
        resolvedMutating: declSites.size - unresolved.length,
        unresolved,
    });
}

/** The table-driven suite. Its existence and its import are the evidence. */
export const SUITE_FILE = join(REPLAY_SPEC_DIR, 'route-coverage.spec.ts');

/**
 * Is the table-driven suite still wired to THIS walk?
 *
 * Two failures, both of which would otherwise leave every route scored
 * `verified` on evidence that no longer exists: the file is gone (renamed,
 * deleted), or it stopped importing `collect` from this script and now walks
 * some other list.
 *
 * @param {string} suiteFile
 * @returns {{ ok: boolean, reason: string | null }}
 */
export function checkSuiteWiring(suiteFile) {
    if (!existsSync(suiteFile)) {
        return {
            ok: false,
            reason:
                `the table-driven suite is MISSING at ${suiteFile}. Every route in this gate is ` +
                'scored on that file driving the real app; without it there is no evidence at all.',
        };
    }
    const src = read(suiteFile);
    if (!src.includes('check-idempotency-coverage.mjs')) {
        return {
            ok: false,
            reason:
                `${suiteFile} no longer imports collect() from check-idempotency-coverage.mjs. ` +
                'The gate and the suite must walk ONE source of paths; two walks drift, and the ' +
                'drift is invisible because both sides still report a number.',
        };
    }
    return { ok: true, reason: null };
}

/** Baseline entries whose reason is missing or blank. */
export function findReasonlessEntries(map) {
    return Object.keys(map ?? {})
        .filter((k) => !String(map[k] ?? '').trim())
        .sort();
}

/** Hono pattern match with the trailing `*` wildcard used in the baseline. */
function pathMatches(pattern, path) {
    if (pattern === path) return true;
    if (pattern.endsWith('/*')) return path.startsWith(pattern.slice(0, -1));
    if (pattern === '*') return true;
    return false;
}

/** "METHOD /path" baseline-key match, wildcard-aware. */
function routeMatches(pattern, route) {
    const [pm, pp] = pattern.split(' ');
    const [rm, rp] = route.split(' ');
    return pm === rm && pathMatches(pp, rp);
}

/**
 * One route's classification. `suiteWired` is the whole population's evidence:
 * when it is false EVERY otherwise-ordinary route falls to `pending`, which is
 * exactly the loud failure a deleted or re-pointed suite deserves.
 *
 * @param {string} route  "METHOD /path"
 * @param {{ unreachableKeys: string[], byDesignKeys: string[], exclusionKeys: string[], suiteWired: boolean }} ctx
 * @returns {'unreachable'|'byDesign'|'excluded'|'verified'|'pending'}
 */
export function classifyRoute(route, { unreachableKeys, byDesignKeys, exclusionKeys, suiteWired }) {
    if (unreachableKeys.some(p => routeMatches(p, route))) return 'unreachable';
    if (byDesignKeys.some(p => routeMatches(p, route))) return 'byDesign';
    if (exclusionKeys.some(p => routeMatches(p, route))) return 'excluded';
    return suiteWired ? 'verified' : 'pending';
}

function main() {
    const update = process.argv.includes('--update');
    const routes = collect();

    // Fail closed. A parser that silently matches nothing reports a clean gate,
    // which is the failure mode this repo keeps rediscovering.
    if (routes.length === 0) {
        console.error(
            'Idempotency-coverage gate: parsed ZERO mutating routes — this gate would pass vacuously.\n' +
            'The route-declaration shape in server/api/ has probably changed. Fix the parser.'
        );
        process.exit(1);
    }

    const wiring = checkSuiteWiring(SUITE_FILE);

    const prior = existsSync(BASELINE_PATH) ? JSON.parse(read(BASELINE_PATH)) : {};
    const uncoveredByDesign = prior.uncoveredByDesign ?? {};
    const knownUnreachable = prior.knownUnreachable ?? {};
    const tableExclusions = prior.tableExclusions ?? {};
    const priorComment = Array.isArray(prior.comment) ? prior.comment : null;
    const priorCoverage = prior.coverage ?? null;

    const byDesignKeys = Object.keys(uncoveredByDesign);
    const unreachableKeys = Object.keys(knownUnreachable);
    const exclusionKeys = Object.keys(tableExclusions);
    const ctx = { unreachableKeys, byDesignKeys, exclusionKeys, suiteWired: wiring.ok };
    const classify = (r) => classifyRoute(r.route, ctx);

    const pendingNow = routes.filter(r => classify(r) === 'pending');
    const coverage = {
        declaredMutating: routes.declaredMutating,
        resolvedMutating: routes.resolvedMutating,
    };
    const unresolvedReport = () => {
        console.error(
            `Idempotency-coverage gate — ${routes.unresolved.length} mutating routes were ` +
            'DECLARED but could not be resolved to a path:'
        );
        for (const { site, text } of routes.unresolved) {
            console.error(`  x server/api/${site}`);
            console.error(`      ${text}`);
        }
        console.error('');
        console.error('The parser does not understand how these are registered, so they appear in');
        console.error('NO list in the baseline — not pending, not verified, not by-design. Their');
        console.error('retry safety is unaudited and this gate is quietly smaller than it claims.');
        console.error('');
        console.error('Do one of:');
        console.error('  - register them in a shape the walk follows: a router mounted (directly or');
        console.error('    transitively) from server/index.ts, chained with `.openapi(routeConst)`,');
        console.error("    `.openapi(createRoute({...}))`, or `.verb('/path', ...)`;");
        console.error('  - teach parseRouters() / parseRouteConsts() the new registration shape;');
        console.error('  - if the route is genuinely unreachable from server/index.ts, say so with a');
        console.error('    reason rather than leaving it silent.');
        console.error('Do NOT close the gap by lowering the declared count — that is the same');
        console.error('blindness written down as a number.');
    };

    if (update) {
        // --update regenerates `pending`; it cannot launder an unresolved
        // declaration, because the verify path recomputes the gap from source
        // every run rather than diffing it against the baseline.
        if (routes.unresolved.length > 0) unresolvedReport();
        writeFileSync(
            BASELINE_PATH,
            JSON.stringify({
                comment: priorComment ?? [
                    'Ledger for mutating-route retry safety. A route is VERIFIED when it is in',
                    'the table tests/unit/idempotency/route-coverage.spec.ts drives — that suite',
                    'imports collect() from this script, so both walk one source of paths. This',
                    'is COVERAGE (the guard is mounted ahead of the route and claims a key when',
                    'a tenant is present), NOT correct replay; the end-to-end replay specs are',
                    'the proof that a replay returns the stored response.',
                    'uncoveredByDesign holds hand-classified judgement calls with reasons and',
                    'supports a trailing `*` wildcard — and it means "no tenant reaches this IN',
                    'SAAS", because in standalone resolveByFixedTenant stamps a tenant on every',
                    'request and these routes ARE guarded there. tableExclusions holds routes',
                    'the table cannot drive, reason required. knownUnreachable is printed on',
                    'every run so it is never silently forgotten. `pending` MUST be empty.',
                ],
                coverage,
                knownUnreachable,
                uncoveredByDesign,
                tableExclusions,
                pending: pendingNow.map(r => r.route).sort(),
            }, null, 4) + '\n',
            'utf8'
        );
        console.log(`Updated ${BASELINE_PATH}: ${pendingNow.length} pending routes (${routes.length} distinct mutating paths from ${coverage.resolvedMutating} of ${coverage.declaredMutating} declarations).`);
        return;
    }

    if (!existsSync(BASELINE_PATH)) {
        console.error(`Idempotency-coverage gate: baseline missing at ${BASELINE_PATH}. Run with --update.`);
        process.exit(1);
    }

    const pendingBaseline = prior.pending ?? [];
    let failed = false;

    // THE structural check. These two counters sat side by side in the baseline
    // for months, 316 against 306, and the difference was the exact number of
    // mutating routes the parser could not place — inline
    // `.openapi(createRoute({...}))` registrations it dropped in silence. A
    // counter that reports a hole without failing is a note, not a gate.
    if (routes.unresolved.length > 0) {
        failed = true;
        unresolvedReport();
        console.error('');
    }

    if (priorCoverage && coverage.resolvedMutating < priorCoverage.resolvedMutating) {
        failed = true;
        console.error('Idempotency-coverage gate — route resolution DROPPED:');
        console.error(
            `  x resolved ${coverage.resolvedMutating} mutating routes; the baseline recorded ` +
            `${priorCoverage.resolvedMutating}. The parser stopped seeing part of the surface — ` +
            `fix the parser, or if routes were genuinely deleted, run --update and say so in the commit.`
        );
        console.error('');
    }

    const stillUnreachable = routes.filter(r => unreachableKeys.some(p => routeMatches(p, r.route)));
    if (stillUnreachable.length > 0) {
        console.warn('Idempotency-coverage gate — KNOWN UNREACHABLE (declared, not failing):');
        for (const r of stillUnreachable) {
            const key = unreachableKeys.find(p => routeMatches(p, r.route));
            console.warn(`  ! ${r.route} — ${knownUnreachable[key]}`);
        }
        console.warn('');
    }

    // THE evidence check. Every `verified` route rests on one file existing and
    // importing this walk; if it does not, the classification above has already
    // dropped the whole population to `pending`, and this says why.
    if (!wiring.ok) {
        failed = true;
        console.error('Idempotency-coverage gate — the table-driven suite is NOT WIRED:');
        console.error(`  x ${wiring.reason}`);
        console.error('');
    }

    // ⚠️ WHY BOTH HAND-MAINTAINED LISTS ARE POLICED HERE, and not by `pending`.
    //
    // Under the old string-literal definition, deleting an `uncoveredByDesign`
    // entry pushed its route straight into `pending` and the gate went red. That
    // is no longer true: the table drives EVERY route the walk finds, so a route
    // whose by-design entry is deleted simply reclassifies as `verified` and
    // nothing complains. The judgement "no tenant reaches this in saas" would
    // then evaporate silently — which is the failure mode this whole file exists
    // to prevent. So the lists are policed directly: an entry must name a route
    // that still exists, and must carry a written reason.
    for (const [label, map, keys] of [
        ['uncoveredByDesign', uncoveredByDesign, byDesignKeys],
        ['tableExclusions', tableExclusions, exclusionKeys],
    ]) {
        const reasonless = findReasonlessEntries(map);
        if (reasonless.length > 0) {
            failed = true;
            console.error(`Idempotency-coverage gate — ${label} entries with NO written reason:`);
            for (const k of reasonless) console.error(`  x ${k}`);
            console.error('');
            console.error('A bare entry is indistinguishable from a forgotten one. Say WHY: no tenant');
            console.error('reaches this route in saas, it owns its dedup, or the table cannot drive it.');
        }
        const staleKeys = keys.filter(k => !routes.some(r => routeMatches(k, r.route)));
        if (staleKeys.length > 0) {
            failed = true;
            console.error(`Idempotency-coverage gate — STALE ${label} (route gone, or renamed):`);
            for (const k of staleKeys) console.error(`  x ${k}`);
            console.error('');
            console.error('An entry that matches nothing is a judgement about a route that no longer');
            console.error('exists. Delete it, or fix the path it names.');
        }
    }

    if (pendingNow.length > 0) {
        failed = true;
        console.error('Idempotency-coverage gate — mutating routes with NO verified retry safety:');
        for (const r of pendingNow) {
            console.error(`  x ${r.route}  (server/api/${r.file})`);
            console.error(
                '      the table-driven suite drives every route this walk finds, so a residual ' +
                'here means the suite is not wired, or the route is excluded/by-design without ' +
                'an entry saying so'
            );
        }
        console.error('');
        console.error(`\`pending\` MUST be empty. Add the route to "uncoveredByDesign" (no tenant`);
        console.error('reaches it in saas, or it owns its dedup) or to "tableExclusions" (the table');
        console.error(`cannot drive it) in ${BASELINE_PATH}, with a written reason either way.`);
    }

    const stale = pendingBaseline.filter(p => !pendingNow.some(r => r.route === p));
    if (stale.length > 0) {
        failed = true;
        console.error('Idempotency-coverage gate — STALE pending entries (route gone, or now verified):');
        for (const p of stale) console.error(`  x ${p}`);
        console.error('');
        console.error('Delete them from the baseline (or run --update). A ratchet with dead');
        console.error('entries overstates the remaining debt and hides real regressions.');
    }

    if (failed) process.exit(1);
    const counts = { verified: 0, byDesign: 0, excluded: 0, unreachable: 0, pending: 0 };
    for (const r of routes) counts[classify(r)]++;
    console.log(
        `Idempotency-coverage gate: OK (${routes.length} mutating routes resolved; ` +
        `${counts.verified} verified by the coverage table, ${counts.byDesign} by design, ` +
        `${counts.excluded} table-excluded, ${counts.unreachable} unreachable, ` +
        `${counts.pending} pending). Coverage, not correct replay.`
    );
}

// Run only when executed directly, not when imported. `collect` is consumed by
// route-coverage.spec.ts, and an unguarded main() would run the whole gate --
// and call process.exit -- inside the test process.
// Normalize both sides to forward-slash lowercase so Windows drive letters
// don't break the comparison (same idiom as check-tenant-scoping.mjs).
const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
const _argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith('/check-idempotency-coverage.mjs')) {
    main();
}
