#!/usr/bin/env node
/**
 * Agent-terms route classification gate.
 *
 * The agent-terms middleware is mounted on `*` and keyed on the actor, so a new
 * agent route is behind it without anyone remembering. That default is the safe
 * one. Its cost is that the OPPOSITE decision is invisible: a route deliberately
 * left open and a route nobody has looked at are both spelled as absence from a
 * short hand-kept exemption list.
 *
 * `server/lib/middleware/agent-terms-routes.ts` replaces that list with a table
 * carrying one row per agent-reachable path, each answering in prose whether
 * using it requires the agent to be bound by the Agent Terms; the exempt Set is
 * derived from the rows that answer no. This gate is the half that cannot be
 * forgotten: it reads the routers the application mounts, and fails when a path
 * has no row.
 *
 * ---------------------------------------------------------------------------
 * DO NOT CONFUSE THIS WITH `lint:agent-routes`
 * ---------------------------------------------------------------------------
 * `scripts/check-agent-routes.mjs` is about UI route PREFIXES under
 * `app/routes/agent-layout.tsx` and which sign-in door a session lands on. It
 * shares three words with this gate and has nothing to do with it. Different
 * registry key (`agenttermsclass` against `agentroutes`), different input,
 * different failure.
 *
 * ---------------------------------------------------------------------------
 * BOTH NUMBERS, EVERY RUN
 * ---------------------------------------------------------------------------
 * Routes examined prints beside routes flagged, pass or fail, plus what was
 * skipped and why. Zero flagged is a pass. **Zero examined is a hard failure** —
 * it means the reader is broken, not that the repo is clean. This repository has
 * shipped gates that ran green because they could not reach their target: one
 * searched for a word a cleanup had renamed, one was anchored to a line ending
 * so a whole section went invisible. A gate that speaks only when it is angry
 * cannot be checked on the day it is quiet.
 *
 * ---------------------------------------------------------------------------
 * LIMITS, stated so a green run is not read as more than it is
 * ---------------------------------------------------------------------------
 *   - The universe is the three mounts an authenticated agent session reaches
 *     with its own cookie: `/api/agent`, `/api/agent-signup`, `/api/identities`.
 *     Mounts are matched EXACTLY, which is what keeps the staff-facing
 *     `/api/agents` router (plural, different audience) out of the reckoning.
 *   - `GET /agent/magic-login` is mounted at the ROOT rather than under one of
 *     those, and is therefore not examined here. It is a redeem endpoint reached
 *     without a session in every normal flow. Counted and named in the skip
 *     line, never dropped silently.
 *   - Anything under `/api/public` is outside the middleware entirely: the JWT
 *     middleware short-circuits those paths before it classifies anybody, so the
 *     actor variable is never set. That is a third answer — outside the
 *     reckoning — and `server/api/unsubscribe.ts` says in its own header that it
 *     must never be moved into the exempt list.
 *   - Routes are read from source, statically. The companion spec
 *     `tests/unit/legal/agent-terms-classification.spec.ts` reads the same
 *     universe from the RUNNING application and asserts the two agree, which is
 *     the positive control on this parser going blind.
 *
 * Usage:
 *   node scripts/check-agent-terms-classification.mjs
 *   node scripts/check-agent-terms-classification.mjs --self-test
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The mounts an authenticated agent session reaches. Matched exactly. */
export const AGENT_MOUNTS = ['/api/agent', '/api/agent-signup', '/api/identities'];

const ENTRY = 'server/index.ts';
const TABLE = 'server/lib/middleware/agent-terms-routes.ts';

/* ────────────────────────────── source reading ────────────────────────────── */

function parse(source, fileName) {
    return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Walk every node, depth first. */
function walk(node, visit) {
    visit(node);
    ts.forEachChild(node, (child) => walk(child, visit));
}

/**
 * The string a node denotes, or null.
 *
 * Handles `'a' + 'b'` because the table's prose is written that way to stay
 * inside the line length, and a `why` that read as null would look like a
 * missing reason rather than a parser that stopped at the first plus.
 */
export function literalString(node) {
    if (!node) return null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = literalString(node.left);
        const right = literalString(node.right);
        return left === null || right === null ? null : left + right;
    }
    return null;
}

/** The object literal a `createRoute(...)` call ultimately describes. */
function routeObjectLiteral(call) {
    for (const arg of call.arguments) {
        if (ts.isObjectLiteralExpression(arg)) return arg;
        // `createRoute(withMcpMetadata({ … }, { … }))` — the shape every route
        // in this tree uses. The route is the wrapper's FIRST argument.
        if (ts.isCallExpression(arg) && arg.arguments.length && ts.isObjectLiteralExpression(arg.arguments[0])) {
            return arg.arguments[0];
        }
    }
    return null;
}

function propertyValue(objectLiteral, name) {
    for (const prop of objectLiteral.properties) {
        if (!ts.isPropertyAssignment(prop)) continue;
        const key = ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name) ? prop.name.text : null;
        if (key === name) return prop.initializer;
    }
    return null;
}

/**
 * OpenAPI writes parameters as `{id}`; the router serves them as `:id`. Both
 * spellings name one path and only one of them is what a request presents.
 */
export function normalizeRoutePath(path) {
    return path.replace(/\{([^}]+)\}/g, ':$1');
}

/** Join a mount prefix with a declared route path. */
export function joinPath(mount, routePath) {
    const base = mount === '/' ? '' : mount.replace(/\/$/, '');
    const tail = routePath === '/' ? '' : `/${routePath.replace(/^\//, '').replace(/\/$/, '')}`;
    return `${base}${tail}` || '/';
}

/**
 * Everything this gate needs from one module: which named route definitions
 * exist, which router carries which of them, what each router re-mounts, and
 * where its imported identifiers come from.
 */
export function parseModule(source, fileName) {
    const sf = parse(source, fileName);

    /** routeConstName -> declared path */
    const routeDefs = new Map();
    /** routerName -> { openapi: string[], mounts: {prefix, ident}[] } */
    const routers = new Map();
    /** localName -> { specifier, exported } */
    const imports = new Map();
    /** localName re-exported as the module default */
    let defaultExport = null;

    walk(sf, (node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const specifier = node.moduleSpecifier.text;
            const clause = node.importClause;
            if (!clause) return;
            if (clause.name) imports.set(clause.name.text, { specifier, exported: 'default' });
            if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
                for (const el of clause.namedBindings.elements) {
                    imports.set(el.name.text, { specifier, exported: (el.propertyName ?? el.name).text });
                }
            }
            return;
        }

        if (ts.isExportAssignment(node) && !node.isExportEquals && ts.isIdentifier(node.expression)) {
            defaultExport = node.expression.text;
            return;
        }

        if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name) || !node.initializer) return;
        const name = node.name.text;

        // `const someRoute = createRoute(...)`
        if (ts.isCallExpression(node.initializer)
            && ts.isIdentifier(node.initializer.expression)
            && node.initializer.expression.text === 'createRoute') {
            const obj = routeObjectLiteral(node.initializer);
            const declared = obj ? literalString(propertyValue(obj, 'path')) : null;
            if (declared !== null) routeDefs.set(name, normalizeRoutePath(declared));
            return;
        }

        // `const someRouter = createApiRouter().openapi(x, …).route('/', y)`
        const chain = { openapi: [], mounts: [] };
        let cursor = node.initializer;
        let rooted = false;
        while (ts.isCallExpression(cursor)) {
            const callee = cursor.expression;
            if (ts.isIdentifier(callee)) {
                rooted = callee.text === 'createApiRouter' || callee.text === 'OpenAPIHono';
                break;
            }
            if (!ts.isPropertyAccessExpression(callee)) break;
            const member = callee.name.text;
            if (member === 'openapi' && cursor.arguments.length && ts.isIdentifier(cursor.arguments[0])) {
                // `.openapi(routeConst, handler)` registers a route. A zod
                // schema's `.openapi('SchemaName')` takes a STRING and is
                // deliberately not matched here.
                chain.openapi.push(cursor.arguments[0].text);
            }
            if (member === 'route' && cursor.arguments.length >= 2) {
                const prefix = literalString(cursor.arguments[0]);
                const ident = ts.isIdentifier(cursor.arguments[1]) ? cursor.arguments[1].text : null;
                if (prefix !== null && ident) chain.mounts.push({ prefix, ident });
            }
            cursor = callee.expression;
            if (ts.isNewExpression(cursor)) { rooted = true; break; }
        }
        if (rooted) routers.set(name, chain);
    });

    return { routeDefs, routers, imports, defaultExport };
}

/** Every `.route('<prefix>', <ident>)` in a file, regardless of what it hangs off. */
export function parseMounts(source, fileName) {
    const sf = parse(source, fileName);
    const mounts = [];
    walk(sf, (node) => {
        if (!ts.isCallExpression(node)) return;
        if (!ts.isPropertyAccessExpression(node.expression)) return;
        if (node.expression.name.text !== 'route') return;
        if (node.arguments.length < 2) return;
        const prefix = literalString(node.arguments[0]);
        const ident = ts.isIdentifier(node.arguments[1]) ? node.arguments[1].text : null;
        if (prefix !== null && ident) mounts.push({ prefix, ident });
    });
    return { mounts, imports: parseModule(source, fileName).imports };
}

/* ─────────────────────────── the universe of routes ────────────────────────── */

/**
 * Resolve every agent-reachable path from source.
 *
 * `readFile(path)` takes a repo-relative path and returns its text or null;
 * injected so the self-test can drive this over literal fixtures rather than
 * over the tree it is meant to be checking.
 */
export function collectAgentRoutes({ readFile, entry = ENTRY, mounts = AGENT_MOUNTS }) {
    const paths = new Set();
    const skipped = [];
    const problems = [];

    const entrySource = readFile(entry);
    if (entrySource === null) {
        problems.push(`could not read ${entry}`);
        return { paths: [], skipped, problems, mountsExamined: 0, mountsSeen: 0 };
    }

    const { mounts: declared, imports } = parseMounts(entrySource, entry);
    let mountsExamined = 0;

    const resolveModule = (fromFile, specifier) => {
        if (!specifier.startsWith('.')) return null;
        const base = join(dirname(fromFile), specifier).replace(/\\/g, '/');
        for (const candidate of [`${base}.ts`, `${base}/index.ts`]) {
            if (readFile(candidate) !== null) return candidate;
        }
        return null;
    };

    const descend = (file, exportName, prefix, seen) => {
        const key = `${file}#${exportName}@${prefix}`;
        if (seen.has(key)) return;
        seen.add(key);

        const source = readFile(file);
        if (source === null) { problems.push(`could not read ${file}`); return; }
        const mod = parseModule(source, file);

        const routerName = exportName === 'default' ? mod.defaultExport : exportName;
        const chain = routerName ? mod.routers.get(routerName) : null;
        if (!chain) {
            problems.push(`no router named ${exportName} found in ${file}`);
            return;
        }

        for (const routeConst of chain.openapi) {
            const declaredPath = mod.routeDefs.get(routeConst);
            if (declaredPath === undefined) {
                problems.push(`${file}: route constant ${routeConst} has no readable path`);
                continue;
            }
            paths.add(joinPath(prefix, declaredPath));
        }

        for (const sub of chain.mounts) {
            const nested = joinPath(prefix, sub.prefix);
            const localChain = mod.routers.get(sub.ident);
            if (localChain) { descend(file, sub.ident, nested, seen); continue; }
            const imported = mod.imports.get(sub.ident);
            if (!imported) { problems.push(`${file}: cannot resolve ${sub.ident}`); continue; }
            const target = resolveModule(file, imported.specifier);
            if (!target) { problems.push(`${file}: cannot resolve module ${imported.specifier}`); continue; }
            descend(target, imported.exported, nested, seen);
        }
    };

    for (const mount of declared) {
        if (!mounts.includes(mount.prefix)) {
            skipped.push(`${mount.prefix} → ${mount.ident}`);
            continue;
        }
        const imported = imports.get(mount.ident);
        if (!imported) { problems.push(`${entry}: cannot resolve ${mount.ident}`); continue; }
        const target = resolveModule(entry, imported.specifier);
        if (!target) { problems.push(`${entry}: cannot resolve module ${imported.specifier}`); continue; }
        mountsExamined += 1;
        descend(target, imported.exported, mount.prefix, new Set());
    }

    return {
        paths: [...paths].sort(),
        skipped,
        problems,
        mountsExamined,
        mountsSeen: declared.length,
    };
}

/* ──────────────────────────── the classification table ─────────────────────── */

/** Read `AGENT_ROUTE_BINDING` out of its module without executing it. */
export function collectBindingTable(source, fileName = TABLE) {
    const sf = parse(source, fileName);
    const rows = [];
    let found = false;

    walk(sf, (node) => {
        if (!ts.isVariableDeclaration(node)) return;
        if (!ts.isIdentifier(node.name) || node.name.text !== 'AGENT_ROUTE_BINDING') return;
        let init = node.initializer;
        while (init && (ts.isAsExpression(init) || ts.isSatisfiesExpression?.(init))) init = init.expression;
        if (!init || !ts.isArrayLiteralExpression(init)) return;
        found = true;
        for (const element of init.elements) {
            if (!ts.isObjectLiteralExpression(element)) continue;
            const path = literalString(propertyValue(element, 'path'));
            const why = literalString(propertyValue(element, 'why'));
            const requires = propertyValue(element, 'requiresBinding');
            rows.push({
                path,
                why: why ?? '',
                requiresBinding: requires ? requires.kind === ts.SyntaxKind.TrueKeyword : null,
            });
        }
    });

    return { rows, found };
}

/* ──────────────────────────────── the judgement ────────────────────────────── */

const MIN_REASON_CHARS = 20;

/** Compare the universe against the table. Pure; the self-test drives it. */
export function evaluate(universe, rows) {
    const classified = new Set(rows.map((row) => row.path));
    const mounted = new Set(universe);

    const unclassified = universe.filter((path) => !classified.has(path));
    const orphaned = rows.map((row) => row.path).filter((path) => path && !mounted.has(path));
    const patterned = rows
        .filter((row) => row.requiresBinding === false && /[:*{]/.test(row.path ?? ''))
        .map((row) => row.path);
    const undecided = rows.filter((row) => row.requiresBinding === null).map((row) => row.path);
    const reasonless = rows
        .filter((row) => (row.why ?? '').trim().length < MIN_REASON_CHARS)
        .map((row) => row.path);
    const seen = new Map();
    for (const row of rows) seen.set(row.path, (seen.get(row.path) ?? 0) + 1);
    const duplicated = [...seen].filter(([, n]) => n > 1).map(([path]) => path);

    const findings = [
        ['reach this route with an agent session and answer nothing — add a row saying whether using it requires the agent to be bound', unclassified],
        ['are named in the table but mounted nowhere — a stale exempt string is indistinguishable from a live exemption', orphaned],
        ['are exempt AND written as a route pattern — the match is exact, so this exempts nothing at all', patterned],
        ['carry no readable requiresBinding value', undecided],
        [`carry a reason shorter than ${MIN_REASON_CHARS} characters — the table answers a question and a blank answers none`, reasonless],
        ['appear on more than one row — two answers to one question, and the second wins silently', duplicated],
    ].filter(([, items]) => items.length > 0);

    const flagged = findings.reduce((sum, [, items]) => sum + items.length, 0);
    return { examined: universe.length, flagged, findings };
}

/* ─────────────────────────────────── CLI ───────────────────────────────────── */

function run() {
    const readFile = (relative) => {
        const abs = join(ROOT, relative);
        return existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    };

    const universeResult = collectAgentRoutes({ readFile });
    const tableSource = readFile(TABLE);
    if (tableSource === null) {
        console.error(`agent-terms classification: could not read ${TABLE} — the reader is broken, not the repo.`);
        return 1;
    }
    const { rows, found } = collectBindingTable(tableSource);
    if (!found) {
        console.error('agent-terms classification: AGENT_ROUTE_BINDING was not found in its own module — the reader is broken, not the repo.');
        return 1;
    }

    const result = evaluate(universeResult.paths, rows);

    console.log(
        `agent-terms classification: examined ${result.examined} agent-reachable route(s) · `
        + `flagged ${result.flagged} · rows in the table ${rows.length} · `
        + `mounts descended ${universeResult.mountsExamined} of ${universeResult.mountsSeen} declared `
        + `(${universeResult.skipped.length} skipped: not one of ${AGENT_MOUNTS.join(', ')})`,
    );

    // Zero examined means the reader is broken, not that the repo is clean.
    if (result.examined === 0) {
        console.error('  ✘ ZERO routes examined. A gate that reaches nothing passes everything — the reader is broken, not the repo.');
        return 1;
    }
    if (rows.length === 0) {
        console.error('  ✘ the classification table is EMPTY — an empty table would leave every route below unanswered and still print a count.');
        return 1;
    }

    if (universeResult.problems.length) {
        for (const problem of universeResult.problems) console.error(`  ✘ reader problem: ${problem}`);
        return 1;
    }

    if (result.flagged === 0) {
        console.log('  ✓ every agent-reachable route says whether using it requires the agent to be bound.');
        return 0;
    }

    for (const [why, items] of result.findings) {
        console.error(`  ✘ ${items.length} route(s) ${why}:`);
        for (const item of items) console.error(`      ${item}`);
    }
    console.error(`\n  fix: ${TABLE}`);
    return 1;
}

/* ───────────────────────────────── self-test ───────────────────────────────── */

const FIXTURE_ENTRY = `
import agentRoutes from './api/agent';
import identityRoutes from './api/identity';
import agentsRoutes from './api/agents';
const app = new OpenAPIHono()
  .route('/api/agent', agentRoutes)
  .route('/api/identities', identityRoutes)
  .route('/api/agents', agentsRoutes);
`;

const FIXTURE_AGENT = `
import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import prefRoutes from './agent/prefs';
const listRoute = createRoute(withMcpMetadata({ method: 'get', path: '/referrals' }, {}));
const noticeRoute = createRoute({ method: 'delete', path: '/notices/{id}' });
const agentRoutes = createApiRouter()
  .route('/', prefRoutes)
  .openapi(listRoute, async () => {})
  .openapi(noticeRoute, async () => {});
export default agentRoutes;
`;

const FIXTURE_PREFS = `
import { createRoute } from '@hono/zod-openapi';
const getRoute = createRoute({ method: 'get', path: '/notification-preferences' });
const prefRoutes = createApiRouter().openapi(getRoute, async () => {});
export default prefRoutes;
`;

const FIXTURE_IDENTITY = `
import { createRoute } from '@hono/zod-openapi';
const identityRoutes = createApiRouter().openapi(exportRoute, async () => {});
const exportRoute = createRoute({ method: 'post', path: '/account/export' });
export default identityRoutes;
`;

const FIXTURE_AGENTS = `
export const agentsRoutes = createApiRouter().openapi(inviteRoute, async () => {});
const inviteRoute = createRoute({ method: 'post', path: '/invite' });
`;

const FIXTURE_FILES = {
    'server/index.ts': FIXTURE_ENTRY,
    'server/api/agent.ts': FIXTURE_AGENT,
    'server/api/agent/prefs.ts': FIXTURE_PREFS,
    'server/api/identity.ts': FIXTURE_IDENTITY,
    'server/api/agents.ts': FIXTURE_AGENTS,
};

const FIXTURE_UNIVERSE = [
    '/api/agent/notices/:id',
    '/api/agent/notification-preferences',
    '/api/agent/referrals',
    '/api/identities/account/export',
];

function selfTest() {
    const failures = [];
    const check = (label, actual, expected) => {
        const a = JSON.stringify(actual);
        const e = JSON.stringify(expected);
        if (a === e) { console.log(`  ✓ ${label}`); return; }
        failures.push(`${label}\n      expected ${e}\n      actual   ${a}`);
        console.error(`  ✘ ${label}`);
    };

    const readFixture = (path) => FIXTURE_FILES[path] ?? null;
    const universe = collectAgentRoutes({ readFile: readFixture });

    // The reader itself: mounts resolved through an import, a nested `.route()`,
    // an OpenAPI `{id}` normalised to `:id`, and the staff-facing `/api/agents`
    // NOT swept in by a prefix match on `/api/agent`.
    check('reads the fixture universe', universe.paths, FIXTURE_UNIVERSE);
    check('reports no reader problems on the fixture', universe.problems, []);
    check('skips the mount that is not an agent mount', universe.skipped, ['/api/agents → agentsRoutes']);

    const complete = FIXTURE_UNIVERSE.map((path) => ({
        path, requiresBinding: true, why: 'a reason long enough to be a reason',
    }));
    check('a fully classified table passes', evaluate(universe.paths, complete).flagged, 0);
    check('and still reports what it examined', evaluate(universe.paths, complete).examined, 4);

    const missingOne = complete.filter((row) => row.path !== '/api/agent/referrals');
    const missing = evaluate(universe.paths, missingOne);
    check('an unclassified route is flagged', missing.flagged, 1);
    check('and is NAMED, not counted', missing.findings[0][1], ['/api/agent/referrals']);

    // The blinding case. A reader that reaches nothing must fail, not pass.
    const blind = evaluate([], complete);
    check('an empty universe flags nothing — which is why the CLI treats it as fatal', blind.flagged, 4);
    check('and the CLI\'s own guard sees zero examined', blind.examined, 0);

    const patterned = [
        { path: '/api/agent/notices/:id', requiresBinding: false, why: 'a reason long enough to be a reason' },
        ...complete.filter((row) => row.path !== '/api/agent/notices/:id'),
    ];
    check('an exemption written as a pattern is flagged', evaluate(universe.paths, patterned).flagged, 1);

    const orphan = [...complete, { path: '/api/agent/gone', requiresBinding: true, why: 'a reason long enough to be a reason' }];
    check('a row naming an unmounted path is flagged', evaluate(universe.paths, orphan).flagged, 1);

    const blank = complete.map((row, i) => (i === 0 ? { ...row, why: 'too short' } : row));
    check('a row with no real reason is flagged', evaluate(universe.paths, blank).flagged, 1);

    // The table reader, over the shape the real module is written in.
    const parsed = collectBindingTable(
        "export const AGENT_ROUTE_BINDING = [{ path: '/a', requiresBinding: false, why: 'one ' + 'two' }];",
        'fixture.ts',
    );
    check('reads a row out of source', parsed.rows, [{ path: '/a', why: 'one two', requiresBinding: false }]);
    check('and knows when the table is absent', collectBindingTable('export const OTHER = [];', 'fixture.ts').found, false);

    console.log(`\nagent-terms classification self-test: ${failures.length === 0 ? 'PASS' : 'FAIL'} · ${failures.length} failure(s)`);
    if (failures.length) {
        for (const failure of failures) console.error(`  ✘ ${failure}`);
        return 1;
    }
    return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
