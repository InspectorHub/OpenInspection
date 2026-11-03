#!/usr/bin/env node
/**
 * Public projection: a route reachable without signing in answers with a response built from a LIST OF FIELDS.
 *
 * Scans the modules that serve those routes (TypeScript AST, not regex) and reports each response whose content is a bare
 * row, a property or spread of one, or the result of a call that is not a known projection (`projectFields`,
 * `projectReportForLink`, a schema `.parse`, ...). The rule and its recognised shapes are in
 * scripts/lib/public-projection-detect.mjs; the helper is server/lib/response-projection.ts; the note for developers is
 * docs/develop/public-response-projection.md.
 *
 * WHICH MODULES. PUBLIC_MODULES below is data, kept by hand, and so is OUT_OF_SCOPE (a module that sits on or beside a path
 * the session middleware leaves open and is deliberately not scanned, with the reason). Two checks read the code instead
 * of the lists: every `.route('/api/public...', X)` mount in server/index.ts must resolve to a scanned module, and every
 * path or prefix that server/lib/auth/public-paths.ts leaves unauthenticated must resolve, through the mounts in
 * server/index.ts and server/portal/integration.module.ts, to modules that are scanned or listed in OUT_OF_SCOPE. The
 * scope is the MODULE: a module that holds public and signed-in routes together is scanned whole.
 *
 * Fail-closed checks: a glob that matches no file; a listed module with no response-producing call although it registers
 * routes; a mount whose module is not in the set; a mount the reader cannot resolve; an unauthenticated /api path with no
 * mount; an OUT_OF_SCOPE entry that is gone or is also scanned; zero modules or responses.
 *
 * Existing findings are frozen per file in scripts/public-projection-baseline.json ({ path: count }; the count is per
 * file, so a fix and a new finding in the same file net out) and may only shrink: `--write-baseline` lowers it and refuses to raise it (it creates the file when there is none). An intentional
 * exception is `// projection-allow: <reason>` above the statement; the reason is mandatory.
 *
 * Prints BOTH numbers on every run (responses scanned, findings, against the baseline), and fails when it scanned nothing,
 * when its listing disagrees with an independent count, or when the detector misses a planted control.
 *
 * Rung: PUSH. It parses a few dozen modules, and what matters is the sum over a branch.
 *
 * Usage: node scripts/check-public-projection.mjs [--write-baseline]
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectPublicProjection } from './lib/public-projection-detect.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = 'scripts/public-projection-baseline.json';
const TAG = '[public-projection]';

/** The modules that serve anonymous and token-gated routes (git pathspecs). */
export const PUBLIC_MODULES = [
    ':(glob)server/api/public*.ts',
    ':(glob)server/api/public/**/*.ts',
    ':(glob)server/api/portal.ts',
    ':(glob)server/api/portal/**/*.ts',
    ':(glob)server/api/bookings.ts',
    ':(glob)server/api/bookings/**/*.ts',
    ':(glob)server/api/widget.ts',
    ':(glob)server/api/repair-builder.ts',
    ':(glob)server/api/repair-builder/**/*.ts',
    ':(glob)server/api/client-documents.ts',
    ':(glob)server/api/messages.ts',
    ':(glob)server/api/sms.ts',
    ':(glob)server/api/sms/**/*.ts',
    ':(glob)server/api/unsubscribe.ts',
    ':(glob)server/api/agent/login.ts',
    ':(glob)server/api/agent/magic-login.ts',
    ':(glob)server/api/agent/report-context.ts',
    ':(glob)server/api/agent-signup.ts',
    ':(glob)server/api/agents.ts',
    ':(glob)server/api/concierge.ts',
    ':(glob)server/api/ics.ts',
    ':(glob)server/api/calendar-ics-links.ts',
    ':(glob)server/api/well-known.ts',
    ':(glob)server/api/auth.ts',
    ':(glob)server/api/places.ts',
    ':(glob)server/api/agreements-render.ts',
    ':(glob)server/api/qbo-oauth.ts',
    // `GET /api/client/compat` answers without a session; the rest of the module needs a native session.
    ':(glob)server/api/client.ts',
    // The create-booking handler returns what this service builds with the request context.
    ':(glob)server/services/booking/fulfill-booking.ts',
];

/**
 * Modules that sit on or beside an unauthenticated path and are deliberately not scanned: path to the reason its answers
 * cannot carry a row.
 */
export const OUT_OF_SCOPE = {
    'server/api/agent.ts': 'every route needs an agent session',
    'server/api/agent/terms.ts': 'every route needs an agent session',
    'server/api/agent/notices.ts': 'every route needs an agent session',
    'server/api/agent/photo.ts': 'every route needs an agent session',
    'server/api/availability.ts': 'every route needs a session',
    'server/api/inspection-requests.ts': 'every route needs a session',
    'server/api/calendar/oauth.ts': 'a signed-in inspector; the answers are a fixed status landing page, a redirect or an error message',
    'server/api/csp-report.ts': 'answers 204 with no body',
    'server/api/stripe-webhook.ts': 'the provider signs the call; the answers are an acknowledgement or an error message',
    'server/api/qbo-webhook.ts': 'the provider signs the call; the answers are an acknowledgement or an error message',
    'server/api/test-hooks.ts': 'answers 404 unless the end-to-end email sink flag is set, which no deployment sets',
    'server/features/setup-wizard/index.ts': 'answers a fixed text; the wizard is a page, not an API',
    'server/portal/integration.routes.ts': 'the portal signs the call (service-binding HMAC); no anonymous caller',
    'server/portal/statutory-admin.routes.ts': 'the portal signs the call (service-binding HMAC); no anonymous caller',
};

/** A route module that answers with what another scanned module builds from the request context; the delegate must be in the set. */
export const DELEGATES = { 'server/api/bookings/create.ts': 'server/services/booking/fulfill-booking.ts' };

const NL = String.fromCharCode(10);
/** A planted case per outcome: each must behave as named. */
export const CONTROLS = [
    { name: 'a bare row is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ success: true, data: row }, 200); });' },
    { name: 'a spread of a row is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ success: true, data: { ...row, extra: 1 } }, 200); });' },
    { name: 'a service result is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => c.json({ success: true, data: await svc.list() }, 200));' },
    { name: 'a row under another key is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ success: true, meta: row }, 200); });' },
    { name: 'a context under another name is followed', expect: 'unprojected-response', src: 'app.get("/x", async (ctx2) => { const row = await db.get(); return ctx2.json({ data: row }, 200); });' },
    { name: 'sendSuccess is followed', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return sendSuccess(c, row); });' },
    { name: 'a stringified row is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return new Response(JSON.stringify(row)); });' },
    { name: 'a property of a row one level inside data is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { item: row.inner } }, 200); });' },
    { name: 'a spread of a row one level inside data is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { item: { ...row } } }, 200); });' },
    { name: 'a row taken as a parameter of a helper is flagged', expect: 'unprojected-response', src: 'function f(c, row) { return c.json({ data: { item: row } }); }' },
    { name: 'a row declared with let, two levels inside data, is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { let row = await db.get(); return c.json({ data: { a: { b: row } } }); });' },
    { name: 'a destructured row, two levels inside data, is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const { inner } = await db.get(); return c.json({ data: { a: { b: inner } } }); });' },
    { name: 'a stringified row given to c.newResponse is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.newResponse(JSON.stringify(row)); });' },
    { name: 'a helper of the same file that is named like a projector is inspected', expect: 'unprojected-response', src: 'function projectThing(x) { return x; }\napp.get("/x", async (c) => { const row = await db.get(); return c.json({ data: projectThing(row) }, 200); });' },
    { name: 'a response helper the gate does not know is flagged', expect: 'unknown-response-helper', src: 'app.get("/x", async (c) => { const row = await db.get(); return jsonOk(c, row); });' },
    { name: 'a projected row passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ success: true, data: projectFields(row, FIELDS) }, 200); });' },
    { name: 'a variable declared from a projection passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); const view = projectFields(row, FIELDS); return c.json({ success: true, data: view }, 200); });' },
    { name: 'an object literal of listed fields passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ success: true, data: { id: row.id, name: row.name } }, 200); });' },
    { name: 'an error response passes', expect: null, src: 'app.get("/x", async (c) => c.json({ success: false, error: { code: "NOT_FOUND", message: "no" } }, 404));' },
    { name: 'an allow comment with a reason passes', expect: null, src: ['app.get("/x", async (c) => {', '  const row = await db.get();', '  // projection-allow: the row is the public listing itself', '  return c.json({ success: true, data: row }, 200);', '});'].join(NL) },
    { name: 'an allow comment without a reason is flagged', expect: 'allow-without-reason', src: ['app.get("/x", async (c) => {', '  const row = await db.get();', '  // projection-allow:', '  return c.json({ success: true, data: row }, 200);', '});'].join(NL) },
];

const isTest = (p) => /\.(?:test|spec)\.tsx?$/.test(p) || p.includes('/__tests__/');
const lsFiles = (...specs) => execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', ...specs], {
    cwd: ROOT, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024,
}).toString('utf8').split('\0').filter((p) => p !== '');

/** Controls whose outcome differs from the stated one. */
export function missedControls(detect = detectPublicProjection, controls = CONTROLS) {
    return controls.filter((c) => {
        const rules = detect(c.src, 'control.ts').violations.map((v) => v.rule);
        return c.expect === null ? rules.length > 0 : !rules.includes(c.expect);
    }).map((c) => c.name);
}

const stripLineComments = (src) => src.split('\n').map((l) => l.replace(/(^|[^:'"`\w])\/\/.*$/, '$1')).join('\n');

/**
 * Every `.route(path, Module)` mount in one file, found from its own text. The identifier is resolved through the
 * relative import that names it; `Module()` (a factory call) reads as the module that exports the factory. A call the
 * reader cannot parse is reported in `problems`, never skipped.
 */
export function parseMounts(src, file = 'server/index.ts') {
    const text = stripLineComments(src);
    const imports = new Map();
    for (const m of text.matchAll(/import\s+(?:type\s+)?(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s*from\s*['"](\.[^'"]*)['"]/g)) {
        const target = posix.normalize(posix.join(posix.dirname(file), m[3]));
        if (m[1]) imports.set(m[1], target);
        for (const part of (m[2] ?? '').split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) imports.set(name, target);
        }
    }
    const mounts = [];
    const problems = [];
    const read = new Set();
    for (const m of text.matchAll(/\.route\(\s*(?:(['"`])([^'"`]*)\1|(\w+))\s*,\s*(\w+)\s*(?:\(\s*\))?\s*\)/g)) {
        read.add(m.index);
        mounts.push({ path: m[2] ?? null, pathName: m[3] ?? null, name: m[4], target: imports.get(m[4]) ?? null });
    }
    for (const m of text.matchAll(/\.route\(/g)) {
        if (!read.has(m.index)) problems.push(`${file}: a .route( call the reader could not parse: ${text.slice(m.index, m.index + 120).split('\n')[0].trim()}`);
    }
    return { mounts, problems };
}

/**
 * The modules that server/index.ts mounts under `/api/public`. Throws when a mount cannot be read: a `.route(` call that
 * does not parse, an identifier that is not a relative import, or one that is not under ./api/. A mount skipped in
 * silence is a module that is never scanned.
 */
export function publicMounts(indexSrc, file = 'server/index.ts') {
    const { mounts, problems } = parseMounts(indexSrc, file);
    const ours = mounts.filter((m) => m.path !== null && m.path.startsWith('/api/public'));
    const bad = problems.filter((p) => p.includes('api/public'));
    for (const m of ours) {
        if (m.target === null) bad.push(`${m.path} is mounted from ${m.name}, which is not a relative import`);
        else if (!m.target.startsWith('server/api/')) bad.push(`${m.path} is mounted from ${m.name} (${m.target}), which is not under ./api/`);
    }
    if (bad.length) throw new Error(`cannot read the /api/public mounts: ${bad.join('; ')}`);
    return ours.map((m) => ({ name: m.name, target: m.target }));
}

/** The module file a mount target names: `<t>.ts` or `<t>/index.ts`. */
export const moduleFile = (target, present) => [`${target}.ts`, `${target}/index.ts`].find((f) => present(f)) ?? null;

/**
 * Every path or prefix that public-paths.ts leaves outside the session middleware, resolved to the modules that answer
 * it: the mounts at, or under, the prefix; failing that, the mounts at the longest enclosing mount (the root and `/api`
 * do not count as enclosing, they would claim everything). An /api literal that resolves to nothing is returned in
 * `unresolved`; any other unmatched literal is a page of the server-rendered app.
 */
export function publicPathModules(publicPathsSrc, mounts) {
    const text = stripLineComments(publicPathsSrc);
    const literals = [
        ...[...text.matchAll(/startsWith\('([^']+)'\)/g)].map((m) => ({ path: m[1], prefix: true })),
        ...[...text.matchAll(/path === '([^']+)'/g)].map((m) => ({ path: m[1], prefix: false })),
    ];
    const lit = mounts.filter((m) => m.path !== null);
    const unresolved = [];
    const modules = new Map();
    for (const { path, prefix } of literals) {
        // `startsWith('/api/')` there is the guard that keeps an /api path from being taken for a static asset; it opens nothing.
        if (path === '/api/') continue;
        const p = path.replace(/\/$/, '');
        let hit = lit.filter((m) => m.path === p || (prefix && m.path.startsWith(`${p}/`)));
        if (hit.length === 0) {
            const container = lit.filter((m) => m.path !== '/' && m.path !== '/api' && p.startsWith(`${m.path}/`))
                .sort((a, b) => b.path.length - a.path.length)[0];
            if (container) hit = lit.filter((m) => m.path === container.path);
        }
        if (hit.length === 0) {
            if (p.startsWith('/api/')) unresolved.push(path);
            continue;
        }
        for (const m of hit) modules.set(`${m.path} ${m.name}`, { via: path, mount: m });
    }
    return { unresolved, modules: [...modules.values()] };
}

function main() {
    const present = (p) => existsSync(join(ROOT, p));
    const emptyGlobs = PUBLIC_MODULES.filter((g) => lsFiles(g).filter((p) => !isTest(p) && present(p)).length === 0);
    const files = [...new Set(PUBLIC_MODULES.flatMap((g) => lsFiles(g)))].filter((p) => !isTest(p) && present(p)).sort();
    // A check of the glob engine: the same names matched by walking the tracked tree with a second matcher.
    const names = PUBLIC_MODULES.map((g) => g.replace(':(glob)', ''));
    const counted = new Set(lsFiles('server').filter((p) => /\.ts$/.test(p) && !isTest(p) && present(p) && names.some((n) => globMatch(n, p))));
    const baseline = existsSync(join(ROOT, BASELINE)) ? JSON.parse(readFileSync(join(ROOT, BASELINE), 'utf8')) : null;

    let sites = 0;
    let unreadable = 0;
    const silent = [];
    const found = new Map();
    for (const path of files) {
        let src;
        try { src = readFileSync(join(ROOT, path), 'utf8'); } catch { unreadable += 1; continue; }
        const r = detectPublicProjection(src, path);
        sites += r.sites;
        if (r.sites === 0 && /\.(?:openapi|get|post|put|patch|delete)\(/.test(src) && !(DELEGATES[path] && files.includes(DELEGATES[path]))) silent.push(path);
        if (r.violations.length) found.set(path, r.violations);
    }
    const total = [...found.values()].reduce((n, v) => n + v.length, 0);
    const counts = Object.fromEntries([...found].map(([p, v]) => [p, v.length]).sort(([a], [b]) => (a < b ? -1 : 1)));

    const read = (p) => (present(p) ? readFileSync(join(ROOT, p), 'utf8') : '');
    const indexSrc = read('server/index.ts');
    let mounts = [];
    const mountProblems = [];
    try { mounts = publicMounts(indexSrc); } catch (e) { mountProblems.push(e.message); }
    const unlisted = mounts.filter((m) => !files.some((f) => f === `${m.target}.ts` || f === `${m.target}/index.ts`));

    // Second, independent reading: the paths the session middleware leaves open, resolved through every mount we can read.
    const allMounts = ['server/index.ts', 'server/portal/integration.module.ts'].flatMap((f) => {
        const r = parseMounts(read(f), f);
        mountProblems.push(...r.problems.filter((p) => !p.includes('/api/public')));
        return r.mounts;
    });
    const open = publicPathModules(read('server/lib/auth/public-paths.ts'), allMounts);
    const outOfScope = new Set(Object.keys(OUT_OF_SCOPE));
    const uncovered = [];
    for (const { via, mount } of open.modules) {
        const file = mount.target ? moduleFile(mount.target, present) : null;
        if (file === null) uncovered.push(`${via} -> ${mount.path} ${mount.name} (module not found)`);
        else if (!files.includes(file) && !outOfScope.has(file)) uncovered.push(`${via} -> ${file}`);
    }
    const staleScope = [...outOfScope].filter((f) => !present(f) || files.includes(f));

    if (process.argv.includes('--write-baseline')) {
        const raised = baseline === null ? [] : Object.keys(counts).filter((p) => counts[p] > (baseline[p] ?? 0));
        if (raised.length) {
            console.error(`${TAG} refusing to RAISE the baseline for: ${raised.join(', ')}. Fix the response, or write \`// projection-allow: <reason>\`.`);
            process.exit(1);
        }
        writeFileSync(join(ROOT, BASELINE), `${JSON.stringify(counts, null, 2)}\n`);
        console.log(`${TAG} baseline written: ${Object.keys(counts).length} file(s), ${total} finding(s)`);
        return;
    }

    const base = baseline ?? {};
    const fresh = [...found.keys()].filter((p) => found.get(p).length > (base[p] ?? 0));
    const slack = Object.keys(base).filter((p) => (found.get(p)?.length ?? 0) < base[p]);
    const baselineTotal = Object.values(base).reduce((n, v) => n + v, 0);

    console.log(`\n${TAG} ${files.length} module(s) scanned, ${outOfScope.size} out of scope | ${sites} response(s) | `
        + `${total} finding(s) vs ${baselineTotal} baselined | ${fresh.length} file(s) over baseline | ${slack.length} below baseline | `
        + `${mounts.length} public mount(s), ${open.modules.length} unauthenticated-path module(s) checked | ${unreadable} unreadable`);

    if (process.argv.includes('--all')) for (const [p, v] of found) for (const f of v) console.log(`   ${p}:${f.line}  [${f.rule}] ${f.message}`);

    let failed = false;
    if (files.length === 0 || sites === 0) { console.error(`${TAG} scanned ZERO ${files.length === 0 ? 'modules' : 'responses'}. A scan of nothing is not a clean scan.`); failed = true; }
    if (emptyGlobs.length) { console.error(`${TAG} module glob(s) match no file: ${emptyGlobs.join(', ')}. Update PUBLIC_MODULES.`); failed = true; }
    if (silent.length) { console.error(`${TAG} module(s) register routes but the detector found no response in them: ${silent.join(', ')}.`); failed = true; }
    if (mounts.length === 0) { console.error(`${TAG} found no \`.route('/api/public', ...)\` mount in server/index.ts; the mount check is blind.`); failed = true; }
    if (unlisted.length) { console.error(`${TAG} mounted under /api/public but not in PUBLIC_MODULES: ${unlisted.map((m) => `${m.name} (${m.target})`).join(', ')}.`); failed = true; }
    if (mountProblems.length) { console.error(`${TAG} ${mountProblems.join('; ')}`); failed = true; }
    if (open.modules.length === 0) { console.error(`${TAG} no unauthenticated path in server/lib/auth/public-paths.ts resolved to a mount; the path check is blind.`); failed = true; }
    if (open.unresolved.length) { console.error(`${TAG} unauthenticated /api path(s) with no mount to resolve them: ${open.unresolved.join(', ')}.`); failed = true; }
    if (uncovered.length) { console.error(`${TAG} reachable without a session but neither in PUBLIC_MODULES nor in OUT_OF_SCOPE: ${uncovered.join('; ')}.`); failed = true; }
    if (staleScope.length) { console.error(`${TAG} OUT_OF_SCOPE entr(ies) that are gone or are also scanned: ${staleScope.join(', ')}.`); failed = true; }
    if (baseline === null) { console.error(`${TAG} ${BASELINE} is missing. Create it with: node scripts/check-public-projection.mjs --write-baseline`); failed = true; }
    if (files.length !== counted.size) { console.error(`${TAG} the glob engine and the second matcher disagree (${files.length} vs ${counted.size} modules).`); failed = true; }
    if (unreadable > 0) { console.error(`${TAG} ${unreadable} module(s) could not be read.`); failed = true; }
    const missed = missedControls();
    if (missed.length > 0) { console.error(`${TAG} BROKEN: the detector gave the wrong answer for its own planted case(s): ${missed.join('; ')}.`); failed = true; }
    if (fresh.length) {
        console.error(`\n${fresh.length} file(s) over baseline:\n`);
        for (const p of fresh) for (const v of found.get(p)) console.error(`   ${p}:${v.line}  [${v.rule}] ${v.message}`);
        console.error('\nBuild the response from a field list (server/lib/response-projection.ts), or write `// projection-allow: <reason>` above the statement.');
        console.error('Do not raise the baseline. Lower it with: node scripts/check-public-projection.mjs --write-baseline\n');
        failed = true;
    }
    if (slack.length) {
        console.error(`\n${slack.length} baselined file(s) now have fewer findings than recorded: ${slack.join(', ')}`);
        console.error('Ratchet it down: node scripts/check-public-projection.mjs --write-baseline\n');
        failed = true;
    }
    if (failed) process.exit(1);
    console.log(`${TAG} OK\n`);
}

/** A tiny glob for the patterns above: `*` within a segment, `**` across segments. */
function globMatch(pattern, path) {
    const re = pattern.split('**/').map((part) => part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*')).join('(?:.*/)?');
    return new RegExp(`^${re}$`).test(path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) main();
