#!/usr/bin/env node
/**
 * Mode-disguise gate: four shapes a deployment-mode branch can wear.
 *
 * The gate that existed before this one matched `.APP_MODE` and nothing else.
 * It could not see `branding.isSaas`, could not see `profile.mode !== 'saas'`,
 * and could not see a hand-copied fallback constant — because it matched a
 * SPELLING, not a QUESTION. Nine sites decided a mode-dependent thing without
 * reading a capability, and it reported clean throughout.
 *
 * Four patterns, each with its own pair of numbers. Never merged into one
 * verdict: P1's honest zero would otherwise hide P4's three.
 *
 *   P1  `.APP_MODE` property reads outside the seam.
 *   P2  `.mode === 'saas' | 'standalone'` comparisons outside the seam.
 *   P3  a constant declared in the seam, respelled somewhere else.
 *   P4  every `isSaas` read must be REGISTERED, with the question it answers.
 *
 * P4 is the only one that can catch a spelling this gate has never seen,
 * because it makes each mode-dependent surface identify itself instead of
 * waiting to be matched. It is bidirectional: a registry entry whose file no
 * longer reads `isSaas` is also stray.
 *
 * **P4's scope is the OBTAIN sites — `.isSaas` read off a context or branding
 * object — and not the components that receive `isSaas` as a prop.** The
 * question "which capability answers this" belongs where the value is obtained;
 * a component handed a boolean is answering whatever its caller already
 * decided. That is a real limit, so the gate PRINTS the prop-threading count
 * beside the obtain count rather than leaving the difference invisible — a
 * coverage boundary nobody can see is the thing this whole gate exists about.
 *
 * COMMENTS ARE STRIPPED BEFORE MATCHING. This repo has six recorded incidents
 * of a content-grep gate firing on prose — and the most dangerous prose is a
 * NEGATIVE: explaining "this used to read branding.isSaas" requires writing
 * `branding.isSaas`. Two files in this very branch do exactly that.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SEAM = 'server/lib/deployment-profile.ts';
const REGISTRY = 'server/lib/deployment-mode-surfaces.jsonc';
const SCAN_DIRS = ['server', 'app', 'workers', 'packages'];

/**
 * `branding.ts` derives the `isSaas` field that ships to the client. That is a
 * legitimate mode read — it is computing the wire value, not deciding a
 * behaviour — and P2 must not report it.
 */
const P2_ALLOWED = new Map([
    [SEAM, 'The seam itself — this IS the derivation.'],
    ['server/lib/middleware/branding.ts',
        'Computes the `isSaas` wire field for the client. Transporting the mode, not deciding on it.'],
    ['server/api/auth.ts',
        'The saas login bounce. `loginRedirectBase` is null when PORTAL_API_URL is unset, so a '
        + 'capability read would fail OPEN and serve a local login form on a platform deploy — '
        + 'the mode is the honest predicate here, and login-saas-bounce.test.ts pins it.'],
    ['server/lib/middleware/jwt-auth.ts',
        'The cross-tenant isolation guard. The question is literally "can this deployment hold more '
        + 'than one tenant", which is the mode and nothing else.'],
    ['server/api/session-context.ts',
        'The outbound cooling window, a saas-only anti-abuse measure keyed on tenant age. There is '
        + 'no capability because the window does not exist as a concept in a single-company install.'],
    ['server/lib/email/outbound-cooling-window.ts',
        'Same predicate as above, at its definition. Kept beside `platformFunded` because both '
        + 'halves must hold, and splitting them across a capability would hide that.'],
]);

/** Strip line and block comments so prose cannot trip a content match. */
export function stripComments(src) {
    return src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

export function p1(src) {
    return [...stripComments(src).matchAll(/\.APP_MODE\b/g)].map((m) => m[0]);
}

export function p2(src, file = 'x.ts') {
    if (P2_ALLOWED.has(file)) return [];
    return [...stripComments(src).matchAll(/\.mode\s*[!=]==?\s*['"](?:saas|standalone)['"]/g)]
        .map((m) => m[0]);
}

export function p3(constants, src) {
    const clean = stripComments(src);
    return constants.filter((v) => clean.includes(v));
}

/**
 * @param files    non-test files that READ isSaas (comments already stripped)
 * @param registry parsed entries from the registry file
 * @param sources  optional file → source, to verify a declared capability is read
 */
export function p4(files, registry, sources = {}) {
    const byFile = new Map(registry.map((e) => [e.file, e]));
    const stray = [];
    for (const f of files) {
        const entry = byFile.get(f);
        if (!entry) { stray.push(`${f} — reads isSaas and is not in the registry`); continue; }
        if (entry.capability) {
            const src = sources[f];
            if (src !== undefined && !new RegExp(`\\.${entry.capability}\\b`).test(stripComments(src))) {
                stray.push(`${f} — declares capability '${entry.capability}' but never reads it`);
            }
        }
    }
    // Bidirectional: an entry whose file no longer reads isSaas is stale.
    for (const e of registry) {
        if (!files.includes(e.file)) stray.push(`${e.file} — registered but no longer reads isSaas`);
    }
    return stray;
}

/** Any pattern that scanned nothing is broken, not clean. */
export function scanIsImplausible(counts) {
    return Object.values(counts).some((n) => n === 0);
}

function walk(dir, acc = []) {
    let entries;
    try { entries = readdirSync(join(ROOT, dir)); } catch { return acc; }
    for (const entry of entries) {
        if (entry === 'node_modules' || entry === 'paraglide') continue;
        const rel = `${dir}/${entry}`;
        if (statSync(join(ROOT, rel)).isDirectory()) walk(rel, acc);
        else if (/\.(ts|tsx)$/.test(rel) && !/\.(spec|test)\.tsx?$/.test(rel)) acc.push(rel);
    }
    return acc;
}

function seamConstants() {
    const src = readFileSync(join(ROOT, SEAM), 'utf8');
    return [...src.matchAll(/^const\s+[A-Z_]+\s*=\s*'([^']+)'/gm)].map((m) => m[1]);
}

function readRegistry() {
    if (!existsSync(join(ROOT, REGISTRY))) return [];
    const raw = readFileSync(join(ROOT, REGISTRY), 'utf8').replace(/^\s*\/\/[^\n]*$/gm, '');
    return JSON.parse(raw).surfaces;
}

function selfTest() {
    const checks = [];
    checks.push(['P1 flags a property read',
        p1('c.env.APP_MODE === "saas" ? toApi(c) : c.notFound()').length === 1]);
    checks.push(['P1 ignores a declaration',
        p1("    APP_MODE?: 'standalone' | 'saas';").length === 0]);
    checks.push(['P1 ignores a mention in a comment',
        p1('// it used to read c.env.APP_MODE here').length === 0]);
    checks.push(['P2 flags a mode compare',
        p2("if (profile?.mode !== 'saas') {").length === 1]);
    checks.push(['P2 ignores the wire-value derivation in branding.ts',
        p2("const isSaas = profile?.mode === 'saas';", 'server/lib/middleware/branding.ts').length === 0]);
    checks.push(['P3 flags a respelled constant',
        p3(['00000000-0000-0000-0000-000000000000'],
            "const tenantId = c.env.SINGLE_TENANT_ID || '00000000-0000-0000-0000-000000000000';").length === 1]);
    checks.push(['P4 flags an undeclared isSaas read', p4(['x.tsx'], []).length === 1]);
    checks.push(['P4 flags a declared capability the file does not read',
        p4(['a.tsx'], [{ file: 'a.tsx', capability: 'hasContentMarketplace' }],
            { 'a.tsx': 'const isSaas = ctx.branding.isSaas;' }).length === 1]);
    checks.push(['P4 passes when the file reads the capability it declared',
        p4(['a.tsx'], [{ file: 'a.tsx', capability: 'hasContentMarketplace' }],
            { 'a.tsx': 'ctx.deployment.hasContentMarketplace' }).length === 0]);
    checks.push(['zero files scanned is a failure in every pattern',
        scanIsImplausible({ p1: 0, p2: 0, p3: 0, p4: 0 })]);

    const failed = checks.filter(([, ok]) => !ok);
    for (const [name] of failed) console.error(`  WRONG: ${name}`);
    console.log(`  self-test: ${checks.length} checks, ${failed.length} wrong`);
    return failed.length === 0;
}

function main() {
    if (process.argv.includes('--self-test')) process.exit(selfTest() ? 0 : 1);

    const files = walk(SCAN_DIRS[0]);
    for (const d of SCAN_DIRS.slice(1)) walk(d, files);
    const sources = Object.fromEntries(files.map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]));

    const constants = seamConstants();
    const registry = readRegistry();

    const p1Files = files.filter((f) => f !== SEAM && p1(sources[f]).length > 0);
    const p2Files = files.filter((f) => p2(sources[f], f).length > 0);
    const p3Hits = files
        .filter((f) => f !== SEAM)
        .flatMap((f) => p3(constants, sources[f]).map((v) => `${f} — respells ${v}`));
    const isSaasFiles = files.filter(
        (f) => f !== SEAM && /\.isSaas\b/.test(stripComments(sources[f])),
    );
    // Files that USE isSaas without obtaining it — threaded in as a prop. Out
    // of P4's scope by the decision in this file's header, and counted so the
    // boundary is on screen rather than implied.
    const threaded = files.filter(
        (f) => f !== SEAM
            && !isSaasFiles.includes(f)
            && /\bisSaas\b/.test(stripComments(sources[f])),
    );
    const p4Stray = p4(isSaasFiles, registry, sources);

    // `--list-isSaas` prints the reads the registry must cover, so a human
    // building it works from what the gate sees rather than from a grep that
    // includes comments.
    if (process.argv.includes('--list-isSaas')) {
        for (const f of isSaasFiles) console.log(f);
        return;
    }

    if (scanIsImplausible({ files: files.length, constants: constants.length })) {
        console.error('✘ mode disguises — scanned 0 files or found 0 seam constants. Broken scan.');
        process.exit(1);
    }

    const lines = [
        `P1 .APP_MODE:       ${files.length} non-test files scanned / ${p1Files.length} stray`,
        `P2 mode compare:    ${files.length} non-test files scanned / ${p2Files.length} stray `
            + `(${P2_ALLOWED.size} named exemptions)`,
        `P3 seam constants:  ${constants.length} tracked / ${p3Hits.length} stray`,
        `P4 isSaas surfaces: ${isSaasFiles.length} obtain-sites / ${registry.length} declared / ${p4Stray.length} stray`
            + ` (+${threaded.length} prop-threaded files, out of scope by design)`,
    ];

    const strayTotal = p1Files.length + p2Files.length + p3Hits.length + p4Stray.length;
    const mark = strayTotal === 0 ? '✅' : '✘';
    for (const l of lines) console[strayTotal === 0 ? 'log' : 'error'](`${mark} mode disguises — ${l}`);

    if (strayTotal > 0) {
        // Name them. A count leaves the reader to find them.
        for (const f of p1Files) console.error(`  ✘ P1 ${f} — reads env.APP_MODE outside the seam`);
        for (const f of p2Files) console.error(`  ✘ P2 ${f} — compares profile.mode to a literal`);
        for (const h of p3Hits) console.error(`  ✘ P3 ${h}`);
        for (const s of p4Stray) console.error(`  ✘ P4 ${s}`);
        console.error(`\n  Read a capability from ${SEAM}, or register the surface in ${REGISTRY}`);
        console.error('  with the question it answers. See the header of this script.');
        process.exit(1);
    }
}

main();
