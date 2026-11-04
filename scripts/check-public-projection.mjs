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
 * WHICH MODULES. PUBLIC_MODULES below is data, kept by hand, and so are OUT_OF_SCOPE (a module reached by a path the session
 * middleware leaves open that is deliberately not scanned, with the reason) and PAGE_PATHS (open paths outside /api that no
 * mount answers: pages, or handlers written inline in server/index.ts, which is scanned). Checks that read the code instead:
 * every `.route('/api/public...', X)` mount in server/index.ts must resolve to a scanned module; every path or prefix that
 * server/lib/auth/public-paths.ts leaves open is read in any quote style (the count of `startsWith(` calls and `path ===`
 * comparisons must equal the number read) and must resolve, through the mounts in server/index.ts and
 * server/portal/integration.module.ts, to modules that are scanned or in OUT_OF_SCOPE, or, outside /api, be listed in PAGE_PATHS;
 * a module mounted at the root is held to the same rule. What this cannot see: a route added to a module that is not mounted
 * under a path it reads, a mount written in a form `parseMounts` does not parse (it stops on those), and paths opened by
 * code other than public-paths.ts. The scope is the MODULE: a module that holds public and signed-in routes is scanned whole.
 *
 * Fail-closed checks: a glob that matches no file; a listed module with no response-producing call although it registers
 * routes; a mount whose module is not in the set; a mount or open path the reader cannot resolve; an open literal outside /api that
 * is neither mounted nor in PAGE_PATHS; an OUT_OF_SCOPE or PAGE_PATHS entry that no open path reaches, that is gone, or that is
 * also scanned; zero modules or responses.
 *
 * Existing findings are frozen per file in scripts/public-projection-baseline.json ({ path: count }; the count is per file, so a
 * fix and a new finding in the same file net out) and may only shrink: `--write-baseline` lowers it and refuses to raise it (it
 * creates the file when there is none). An intentional exception is `// projection-allow: <reason>` as a trailing comment (it covers findings that start on its own line)
 * or as a comment-only line (it covers findings that start on the next line); the reason is mandatory, and a marker that excuses nothing is itself a finding.
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
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { detectPublicProjection } from './lib/public-projection-detect.mjs';
import {
    PAGE_PATHS, moduleFile, parseMounts, publicMounts, publicPathModules, readOpenPaths, readPathConstants,
} from './lib/public-projection-mounts.mjs';

export { PAGE_PATHS, moduleFile, parseMounts, publicMounts, publicPathModules, readOpenPaths, readPathConstants };

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
    // The composition file also answers a few unauthenticated routes inline (status, the signed-envelope proof routes, the signing page).
    ':(glob)server/index.ts',
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
    'server/api/stripe-webhook.ts': 'the provider signs the call; the answers are an acknowledgement or an error message',
    'server/api/qbo.ts': 'mounted beside the QuickBooks OAuth callback; only the exact callback path is open and that route is in qbo-oauth.ts (scanned), the rest of this module needs a session',
    'server/api/qbo-webhook.ts': 'the provider signs the call; the answers are an acknowledgement or an error message',
    'server/api/test-hooks.ts': 'answers 404 unless the end-to-end email sink flag is set, which only the end-to-end configuration sets',
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
    { name: 'a whole value copied under its own name at the top level is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: row.data }, 200); });' },
    { name: 'a whole value copied under its own name through an optional chain is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: row?.data }, 200); });' },
    { name: 'a property of a parenthesised await copied under its own name is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { total: (await svc.get()).total } }, 200); });' },
    { name: 'a row inside a conditional is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: row ? { item: row } : null }, 200); });' },
    { name: 'a row in the callback of a map is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: rows.map((r) => ({ id: r.id, whole: r })) }, 200); });' },
    { name: 'a row returned by a function of the same file is flagged', expect: 'unprojected-response', src: ['function view(r) { return { item: r }; }', 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: view(row) }, 200); });'].join(NL) },
    { name: 'a helper that answers with a value it is given is flagged', expect: 'unknown-response-helper', src: 'app.get("/x", async (c) => { const row = await db.get(); return fail(c, row); });' },
    { name: 'a conditional of picked fields passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: row ? { id: row.id, name: row.name } : null }, 200); });' },
    { name: 'a map of picked fields passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: rows.map((r) => ({ id: r.id, name: r.name })) }, 200); });' },
    { name: 'a container member copied under its own name is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { items: row.items } }, 200); });' },
    { name: 'a member ending in Row copied under its own name is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { userRow: row.userRow } }, 200); });' },
    { name: 'a JSON column copied under its own name is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const config = await db.get(); return c.json({ data: { depositPolicy: config?.depositPolicy ?? null } }, 200); });' },
    { name: 'a JSON column copied under its own name from a plain identifier is flagged', expect: 'unprojected-response', src: 'app.get("/x", async (c) => { const s = await db.get(); return c.json({ data: { lineItems: s.lineItems } }, 200); });' },
    { name: 'a scalar member copied under its own name passes', expect: null, src: 'app.get("/x", async (c) => { const row = await db.get(); return c.json({ data: { id: row.id, label: row.label } }, 200); });' },
    { name: 'a marker on the first line of a multi-line response does not excuse a row on a later line', expect: 'unprojected-response', src: ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({ // projection-allow: a flag written on this line only', '    ok: flag(),', '    data: row,', '  }, 200); });'].join(NL) },
    { name: 'a marker on the line of the value excuses that value and no other', expect: 'unprojected-response', src: ['app.get("/x", async (c) => { const row = await db.get();', '  return c.json({', '    ok: flag(), // projection-allow: a boolean flag', '    data: row,', '  }, 200); });'].join(NL) },
    { name: 'a blank line between a comment-only marker and the value leaves the value flagged', expect: 'unprojected-response', src: ['app.get("/x", async (c) => { const row = await db.get();', '  // projection-allow: a comment-only marker covers the next line only', '', '  return c.json({ data: row }, 200); });'].join(NL) },
    { name: 'a trailing marker does not cover the line after it', expect: 'unprojected-response', src: ['app.get("/x", async (c) => { const row = await db.get(); flag(); // projection-allow: a trailing marker covers its own line only', '  return c.json({ data: row }, 200); });'].join(NL) },
    { name: 'text in a template literal that looks like a marker excuses nothing', expect: 'unprojected-response', src: ['app.get("/x", async (c) => { const row = await db.get(); const note = `', '// projection-allow: this is text inside a template literal, not a comment', '`;', '  return c.json({ data: row, note }, 200); });'].join(NL) },
    { name: 'a marker that excuses nothing is flagged', expect: 'unused-projection-allow', src: ['app.get("/x", async (c) => { const row = await db.get();', '  // projection-allow: nothing on the next line needs it', '  return c.json({ data: { id: row.id } }, 200); });'].join(NL) },
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
    // A mount or an open path written with a named constant (the QuickBooks mount and callback) is resolved through the constants file.
    const constants = readPathConstants(read('server/lib/qbo-oauth-paths.ts'));
    for (const m of allMounts) {
        if (m.path === null && m.pathName !== null) {
            if (constants[m.pathName] === undefined) mountProblems.push(`the mount path ${m.pathName} of ${m.name} does not resolve to a string`);
            else m.path = constants[m.pathName];
        }
    }
    const open = publicPathModules(read('server/lib/auth/public-paths.ts'), allMounts, { constants });
    const outOfScope = new Set(Object.keys(OUT_OF_SCOPE));
    const uncovered = [];
    const reached = new Set();
    for (const { via, mount } of [...open.modules, ...open.rootModules]) {
        const file = mount.target ? moduleFile(mount.target, present) : null;
        if (file === null) uncovered.push(`${via} -> ${mount.path} ${mount.name} (module not found)`);
        else {
            reached.add(file);
            if (!files.includes(file) && !outOfScope.has(file)) uncovered.push(`${via} -> ${file}`);
        }
    }
    // An OUT_OF_SCOPE entry must exist, must not also be scanned, and must be reached by an open path or a root mount; otherwise it justifies nothing.
    const staleScope = [...outOfScope].filter((f) => !present(f) || files.includes(f) || !reached.has(f));

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
    if (open.problems.length) { console.error(`${TAG} ${open.problems.join('; ')}.`); failed = true; }
    if (open.unlistedPages.length) { console.error(`${TAG} open path(s) outside /api that no mount answers and PAGE_PATHS does not list: ${open.unlistedPages.join(', ')}.`); failed = true; }
    if (open.stalePages.length) { console.error(`${TAG} PAGE_PATHS entr(ies) that public-paths.ts no longer opens: ${open.stalePages.join(', ')}.`); failed = true; }
    if (open.modules.length === 0) { console.error(`${TAG} no unauthenticated path in server/lib/auth/public-paths.ts resolved to a mount; the path check is blind.`); failed = true; }
    if (open.unresolved.length) { console.error(`${TAG} unauthenticated /api path(s) with no mount to resolve them: ${open.unresolved.join(', ')}.`); failed = true; }
    if (uncovered.length) { console.error(`${TAG} reachable without a session but neither in PUBLIC_MODULES nor in OUT_OF_SCOPE: ${uncovered.join('; ')}.`); failed = true; }
    if (staleScope.length) { console.error(`${TAG} OUT_OF_SCOPE entr(ies) that are gone, are also scanned, or that no open path reaches: ${staleScope.join(', ')}.`); failed = true; }
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
