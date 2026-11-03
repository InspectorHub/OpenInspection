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
 * WHICH MODULES. PUBLIC_MODULES below is data. It is every module that serves an anonymous or token-gated caller: the
 * modules mounted under `/api/public` in server/index.ts (checked independently, see below), the prefixes and exact paths
 * that server/lib/auth/public-paths.ts leaves outside the session middleware (`/api/portal/`, the agent sign-in and
 * sign-up entry points, the concierge links, the calendar feeds, the unsubscribe link, the OAuth callback, `/book`), and
 * the token tracks (the pay link, the repair builder, the share link). The scope is the MODULE: a module that holds public
 * and signed-in routes together is scanned whole. Modules that need a session throughout (server/api/agent.ts,
 * server/api/agent/terms.ts, server/api/agent/notices.ts, server/api/agent/photo.ts) are out of scope.
 *
 * Fail-closed checks: a glob that matches no file; a listed module with no response-producing call although it registers
 * routes; a `.route('/api/public', X)` mount in server/index.ts whose module is not in the set; zero modules or responses.
 *
 * Existing findings are frozen per file in scripts/public-projection-baseline.json ({ path: count }) and may only
 * shrink: `--write-baseline` lowers it and refuses to raise it (it creates the file when there is none). An intentional
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
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
    // The create-booking handler returns what this service builds with the request context.
    ':(glob)server/services/booking/fulfill-booking.ts',
];

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

/**
 * The module files that server/index.ts mounts under `/api/public`, found from its own text: the identifier given to
 * `.route('/api/public...', X)` is resolved through the import that names it. Independent of PUBLIC_MODULES on purpose.
 */
export function publicMounts(indexSrc) {
    const imports = new Map();
    for (const m of indexSrc.matchAll(/import\s+(?:(\w+)(?:\s*,\s*)?)?(?:\{([^}]*)\})?\s*from\s*'(\.\/api\/[^']+)'/g)) {
        const target = m[3].replace(/^\.\//, 'server/');
        if (m[1]) imports.set(m[1], target);
        for (const part of (m[2] ?? '').split(',')) {
            const name = part.trim().split(/\s+as\s+/).pop();
            if (name) imports.set(name, target);
        }
    }
    const mounts = [];
    for (const m of indexSrc.matchAll(/\.route\('\/api\/public[^']*',\s*(\w+)\)/g)) {
        const target = imports.get(m[1]);
        if (target) mounts.push({ name: m[1], target });
    }
    return mounts;
}

function main() {
    const present = (p) => existsSync(join(ROOT, p));
    const emptyGlobs = PUBLIC_MODULES.filter((g) => lsFiles(g).filter((p) => !isTest(p) && present(p)).length === 0);
    const files = [...new Set(PUBLIC_MODULES.flatMap((g) => lsFiles(g)))].filter((p) => !isTest(p) && present(p)).sort();
    // The independent count: every module under server/api that the glob list names, counted by walking the tree and matching the same names.
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

    const indexSrc = present('server/index.ts') ? readFileSync(join(ROOT, 'server/index.ts'), 'utf8') : '';
    const mounts = publicMounts(indexSrc);
    const unlisted = mounts.filter((m) => !files.some((f) => f === `${m.target}.ts` || f === `${m.target}/index.ts`));

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

    console.log(`\n${TAG} ${files.length} module(s) scanned (${counted.size} by independent count) | ${sites} response(s) | `
        + `${total} finding(s) vs ${baselineTotal} baselined | ${fresh.length} file(s) over baseline | ${slack.length} below baseline | ${mounts.length} public mount(s) checked | ${unreadable} unreadable`);

    if (process.argv.includes('--all')) for (const [p, v] of found) for (const f of v) console.log(`   ${p}:${f.line}  [${f.rule}] ${f.message}`);

    let failed = false;
    if (files.length === 0 || sites === 0) { console.error(`${TAG} scanned ZERO ${files.length === 0 ? 'modules' : 'responses'}. A scan of nothing is not a clean scan.`); failed = true; }
    if (emptyGlobs.length) { console.error(`${TAG} module glob(s) match no file: ${emptyGlobs.join(', ')}. Update PUBLIC_MODULES.`); failed = true; }
    if (silent.length) { console.error(`${TAG} module(s) register routes but the detector found no response in them: ${silent.join(', ')}.`); failed = true; }
    if (mounts.length === 0) { console.error(`${TAG} found no \`.route('/api/public', ...)\` mount in server/index.ts; the mount check is blind.`); failed = true; }
    if (unlisted.length) { console.error(`${TAG} mounted under /api/public but not in PUBLIC_MODULES: ${unlisted.map((m) => `${m.name} (${m.target})`).join(', ')}.`); failed = true; }
    if (baseline === null) { console.error(`${TAG} ${BASELINE} is missing. Create it with: node scripts/check-public-projection.mjs --write-baseline`); failed = true; }
    if (files.length !== counted.size) { console.error(`${TAG} module listing disagrees with the independent count (${files.length} vs ${counted.size}).`); failed = true; }
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
