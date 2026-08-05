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
 *   1. VERIFIED — a replay spec names the full route path as a string literal.
 *      The spec is the evidence that a retry of the route is contained (by the
 *      mounted middleware, or by the route's own dedup mechanism — the test
 *      does not care which, and neither do we).
 *   2. In `pending` — the burn-down ratchet: known-unverified routes, shrunk one
 *      commit at a time (give the route coverage, add the replay spec, delete
 *      the entry). `--update` regenerates this list.
 *   3. In `uncoveredByDesign` — hand-maintained judgement calls with a one-line
 *      reason (public endpoints whose retry story is the token itself,
 *      provider-signed webhooks with their own dedup, naturally idempotent
 *      writes). Supports a trailing `*` wildcard.
 *   4. In `knownUnreachable` — routes that permanently 401 / are not mounted;
 *      printed on every run, never silently forgotten.
 *
 * Anything else fails the gate. So does a stale `pending` entry (the route was
 * removed, or gained a replay spec without the entry being deleted) — a ratchet
 * that only ever grows lies about progress.
 *
 * EVIDENCE FILES (the divergence from portal's gate, which scans every spec in
 * its idempotency directory): here a replay spec is a file named
 * `*-replay.spec.ts` under tests/unit/idempotency/, or `*-idempotency.test.ts`
 * anywhere under app/. The mechanism's own unit specs (fingerprint/store/
 * middleware) live in that same directory and quote real route paths as sample
 * input — scanning them would mark routes verified on the strength of a hash
 * test that never calls them.
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
 *   - A router's chain body is delimited by indentation: it runs from the
 *     `const X = createApiRouter()` line to the next line that starts at column
 *     zero. A handler holding a template literal with column-zero content would
 *     truncate it — which is what the `coverage` counters in the baseline are
 *     for: `declaredMutating` counts the raw mutating declarations in the
 *     source, `resolvedMutating` counts the ones this walk actually resolved to
 *     a full path, and a DROP in the resolved count fails the gate.
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
        const decl = lines[i].match(/^(?:export )?const (\w+) = createRoute\(/);
        if (!decl) continue;
        let body = lines[i];
        for (let j = i + 1; j < lines.length && !/^\S/.test(lines[j]); j++) body += `\n${lines[j]}`;
        const method = body.match(/\bmethod:\s*'(\w+)'/)?.[1];
        const path = body.match(/\bpath:\s*'([^']*)'/)?.[1];
        if (!method || !path) continue;
        out.set(decl[1], { method, path });
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

    const harvest = (target, body) => {
        for (const m of body.matchAll(/\.openapi\(\s*(\w+)/g)) target.routeConsts.push(m[1]);
        for (const m of body.matchAll(/\.route\(\s*'([^']*)'\s*,\s*(\w+)\s*\)/g)) {
            target.mounts.push({ prefix: m[1], ident: m[2] });
        }
        // The leading `/` separates a route registration from an unrelated
        // method call (`ALLOWED.delete('x')`, `map.get('k')`).
        for (const m of body.matchAll(/\.(post|put|patch|delete|get)\(\s*'(\/[^']*)'/g)) {
            target.chained.push({ method: m[1], path: m[2] });
        }
    };

    const bodyFrom = (i) => {
        let body = lines[i];
        for (let j = i + 1; j < lines.length && !/^\S/.test(lines[j]); j++) body += `\n${lines[j]}`;
        return body;
    };

    for (let i = 0; i < lines.length; i++) {
        const decl = lines[i].match(/^(?:export )?const (\w+)(?::[^=]+)? = (?:createApiRouter\(|new (?:OpenAPIHono|Hono))/);
        if (!decl) continue;
        harvest(ensure(decl[1]), bodyFrom(i));
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
            harvest(target, bodyFrom(i));
        }
    }

    // Statements written against the ident after the declaration:
    // `clientMessageRoutes.post('/inspections/:id/messages', …)`.
    for (const name of [...routers.keys()]) {
        const stmt = new RegExp(`^${name}\\s*\\n?\\s*\\.[\\s\\S]*?(?=\\n\\S|$)`, 'gm');
        for (const m of src.matchAll(stmt)) harvest(routers.get(name), m[0]);
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
        let body = '';
        for (let j = i + 1; j < lines.length && !/^\S/.test(lines[j]); j++) body += `\n${lines[j]}`;
        const chained = [...body.matchAll(/\brouter\.(post|put|patch|delete|get)\(\s*'(\/[^']*)'/g)]
            .map(m => ({ method: m[1], path: m[2] }));
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

function collect() {
    const files = walkTs(API_DIR);
    const parsed = new Map();
    let declaredMutating = 0;

    for (const f of files) {
        const src = stripComments(read(join(API_DIR, f)));
        // Declared-side tally: every mutating createRoute + every inline
        // mutating verb with a quoted path. The resolved count is ratcheted
        // against this, because a parser that quietly sees less than the
        // surface reports OK either way.
        declaredMutating += (src.match(/\bmethod:\s*'(?:post|put|patch|delete)'/g) ?? []).length;
        declaredMutating += (src.match(/\.(?:post|put|patch|delete)\(\s*'\//g) ?? []).length;
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
    const push = (method, fullPath, file) => {
        if (!MUTATING.has(method)) return;
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
            const rc = entry.consts.get(constName)
                ?? (imported ? parsed.get(imported.file)?.consts.get(imported.exported) : undefined);
            if (!rc) continue;
            push(rc.method, joinPaths(prefix, rc.path), file);
        }
        for (const { method, path } of router.chained) {
            push(method, joinPaths(prefix, path), file);
        }
        // Helper-registered verbs land on the router the helper was called with.
        for (const { fn, ident } of entry.helperCalls) {
            if (ident !== routerName) continue;
            const imported = entry.imports.get(fn);
            const source = imported ? parsed.get(imported.file) : entry;
            const chained = source?.helpers.get(imported ? imported.exported : fn);
            if (!chained) continue;
            for (const { method, path } of chained) {
                push(method, joinPaths(prefix, path), imported ? imported.file : file);
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

    return Object.assign(routes, { declaredMutating });
}

/** Route paths named as string literals in the replay-evidence specs. */
function evidenceText() {
    const parts = [];
    if (existsSync(REPLAY_SPEC_DIR)) {
        for (const f of walkTs(REPLAY_SPEC_DIR)) {
            if (f.endsWith('-replay.spec.ts')) parts.push(read(join(REPLAY_SPEC_DIR, f)));
        }
    }
    if (existsSync(APP_DIR)) {
        for (const f of walkTs(APP_DIR)) {
            if (f.endsWith('-idempotency.test.ts') || f.endsWith('-idempotency.test.tsx')) {
                parts.push(read(join(APP_DIR, f)));
            }
        }
    }
    return parts.join('\n');
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

    const specText = evidenceText();
    const isVerified = (route) => {
        const path = route.split(' ')[1];
        return specText.includes(`'${path}'`) || specText.includes(`"${path}"`);
    };

    const prior = existsSync(BASELINE_PATH) ? JSON.parse(read(BASELINE_PATH)) : {};
    const uncoveredByDesign = prior.uncoveredByDesign ?? {};
    const knownUnreachable = prior.knownUnreachable ?? {};
    const priorComment = Array.isArray(prior.comment) ? prior.comment : null;
    const priorCoverage = prior.coverage ?? null;

    const byDesignKeys = Object.keys(uncoveredByDesign);
    const unreachableKeys = Object.keys(knownUnreachable);
    const classify = (r) => {
        if (unreachableKeys.some(p => routeMatches(p, r.route))) return 'unreachable';
        if (isVerified(r.route)) return 'verified';
        if (byDesignKeys.some(p => routeMatches(p, r.route))) return 'byDesign';
        return 'pending';
    };

    const pendingNow = routes.filter(r => classify(r) === 'pending');
    const coverage = { declaredMutating: routes.declaredMutating, resolvedMutating: routes.length };

    if (update) {
        writeFileSync(
            BASELINE_PATH,
            JSON.stringify({
                comment: priorComment ?? [
                    'Burn-down ledger for mutating-route retry safety. `pending` lists routes',
                    'with NO verified idempotency story yet: to remove one, give the route',
                    'coverage (the mounted guard already covers every tenant-authenticated',
                    'route when the client sends Idempotency-Key; tenant-less routes need',
                    'their own mechanism) and add a replay spec — `*-replay.spec.ts` under',
                    'tests/unit/idempotency/, or `*-idempotency.test.ts` under app/ — that',
                    'names the full route path as a string literal. The spec is the exit',
                    'evidence. uncoveredByDesign holds judgement calls with reasons and',
                    'supports a trailing `*` wildcard; knownUnreachable is printed on every',
                    'run so it is never silently forgotten.',
                ],
                coverage,
                knownUnreachable,
                uncoveredByDesign,
                pending: pendingNow.map(r => r.route).sort(),
            }, null, 4) + '\n',
            'utf8'
        );
        console.log(`Updated ${BASELINE_PATH}: ${pendingNow.length} pending routes (${routes.length} mutating routes resolved of ${routes.declaredMutating} declared).`);
        return;
    }

    if (!existsSync(BASELINE_PATH)) {
        console.error(`Idempotency-coverage gate: baseline missing at ${BASELINE_PATH}. Run with --update.`);
        process.exit(1);
    }

    const pendingBaseline = prior.pending ?? [];
    let failed = false;

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

    const newUncovered = pendingNow.filter(r => !pendingBaseline.includes(r.route));
    if (newUncovered.length > 0) {
        failed = true;
        console.error('Idempotency-coverage gate — mutating routes with NO verified retry safety:');
        for (const r of newUncovered) {
            console.error(`  x ${r.route}  (server/api/${r.file})`);
            console.error(
                '      the mounted guard covers this when a tenant is on the context and the ' +
                'client sends Idempotency-Key — add a replay spec naming this path, or, if no ' +
                'tenant reaches it, give the route its own dedup mechanism first'
            );
        }
        console.error('');
        console.error('Either verify the route (replay spec), or add it to "uncoveredByDesign" in');
        console.error(`${BASELINE_PATH} with a one-line reason. Adding it back to "pending" is the`);
        console.error('option of last resort — the list is a burn-down, not a dumping ground.');
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
    console.log(
        `Idempotency-coverage gate: OK (${routes.length} mutating routes resolved, ` +
        `${pendingBaseline.length} pending, ${routes.filter(r => classify(r) === 'verified').length} verified by replay spec).`
    );
}

main();
