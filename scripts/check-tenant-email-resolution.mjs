#!/usr/bin/env node
/**
 * Tenant email resolution gate (`lint:tenant-email`).
 *
 * `services.email` is the email service the DI middleware built for the tenant
 * it ALREADY KNEW when it ran. It knows one only when an earlier middleware
 * resolved it: a tenant JWT, a tenant slug in the path, an inspection id in a
 * public client path, or the fixed tenant of a single-tenant deployment. A
 * route that learns its tenant INSIDE the handler — a public form naming its
 * company in the body, a token naming its tenant when redeemed, a global agent
 * session — gets the platform-default service there instead, and its mail goes
 * out without the tenant's sender name, Reply-To, brand or provider, unmetered.
 * Nothing fails when that happens; the mail is simply in the wrong voice.
 *
 * So `services.email` may be used only in files listed in
 * `scripts/tenant-email-allowlist.json`, each with the reason its tenant is
 * resolved before the DI middleware. Everything else asks explicitly:
 * `services.emailFor(tenantId)` for a send that speaks for a tenant,
 * `services.platformEmail()` for one that speaks for the deployment.
 *
 * Every run prints the number of uses found, how many are exempt, how many are
 * violations and how many allow-list entries no longer match — a run that
 * finds nothing says so as a number, because a scanner that has stopped
 * matching reports the same silence as a clean tree.
 *
 *   node scripts/check-tenant-email-resolution.mjs            # gate
 *   node scripts/check-tenant-email-resolution.mjs --update   # prune stale entries (never adds)
 *
 * console.* is intentional — build script, not server code.
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Patterns that read the DI-built service. `emailFor` / `platformEmail` are
 * excluded by the trailing identifier guard.
 */
const USE_PATTERNS = [
    // c.var.services.email / services?.email / services.email.sendX(...)
    /\bservices\s*\??\.\s*email(?![\w$])/g,
    // c.get('services').email
    /\bget\(\s*['"]services['"]\s*\)\s*\??\.\s*email(?![\w$])/g,
    // services['email']
    /\bservices\s*\[\s*['"]email['"]\s*\]/g,
    // const { email } = c.var.services  /  const { email: mailer, ... } = c.get('services')
    /\{[^{}]*\bemail\b[^{}]*\}\s*=\s*(?:[\w$.]*\.)?(?:services\b|get\(\s*['"]services['"]\s*\))/g,
];

/** Blank out comments, keeping offsets, so prose that names the API is not a use. */
export function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
        .replace(/(^|[^:])\/\/.*$/gm, (m, p1) => p1 + ' '.repeat(m.length - p1.length));
}

/** Every use of the DI-built service in one source file: `[{ line, snippet }]`. */
export function findServicesEmailUses(source) {
    const code = stripComments(source);
    const hits = [];
    for (const re of USE_PATTERNS) {
        for (const m of code.matchAll(re)) {
            hits.push({
                index: m.index,
                line: code.slice(0, m.index).split('\n').length,
                snippet: m[0].replace(/\s+/g, ' ').slice(0, 80),
            });
        }
    }
    return hits.sort((a, b) => a.index - b.index).map(({ line, snippet }) => ({ line, snippet }));
}

/**
 * Judge a scan against the allow-list.
 *
 * @param {Map<string, Array<{ line: number, snippet: string }>>} usesByFile
 * @param {Record<string, string>} allowlist file -> reason its tenant is resolved before DI
 */
export function evaluate(usesByFile, allowlist) {
    let matches = 0;
    let exempt = 0;
    const violations = [];
    for (const [file, uses] of usesByFile) {
        matches += uses.length;
        if (Object.hasOwn(allowlist, file)) {
            exempt += uses.length;
        } else {
            for (const use of uses) violations.push({ file, ...use });
        }
    }
    const stale = Object.keys(allowlist).filter((file) => (usesByFile.get(file)?.length ?? 0) === 0).sort();
    return { matches, exempt, violations, stale };
}

// ---------------------------------------------------------------------------
// Main scan (only when executed directly or by run-gates, not when imported by a spec)
// ---------------------------------------------------------------------------
const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SERVER = join(ROOT, 'server');
const ALLOWLIST = join(ROOT, 'scripts', 'tenant-email-allowlist.json');

function walk(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        if (statSync(p).isDirectory()) {
            if (entry !== 'node_modules') walk(p, out);
        } else if (/\.tsx?$/.test(entry) && !/\.(spec|test)\.tsx?$/.test(entry) && !entry.endsWith('.d.ts')) {
            out.push(p);
        }
    }
    return out;
}

const _scriptPath = new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1').toLowerCase();
const _argv1 = (process.argv[1] ?? '').replace(/\\/g, '/').toLowerCase();
if (_scriptPath === _argv1 || _argv1.endsWith('/check-tenant-email-resolution.mjs')) {
    const files = walk(SERVER);
    if (files.length === 0) {
        console.error('Tenant email resolution gate: scanned 0 files under server/ — the walk is broken, not the tree.');
        process.exit(1);
    }
    /** @type {Map<string, Array<{ line: number, snippet: string }>>} */
    const usesByFile = new Map();
    for (const file of files) {
        const uses = findServicesEmailUses(readFileSync(file, 'utf8'));
        if (uses.length) usesByFile.set(relative(ROOT, file).replace(/\\/g, '/'), uses);
    }
    const allowlist = JSON.parse(readFileSync(ALLOWLIST, 'utf8'));
    const { matches, exempt, violations, stale } = evaluate(usesByFile, allowlist);

    if (process.argv.includes('--update')) {
        const kept = Object.fromEntries(Object.entries(allowlist).filter(([file]) => !stale.includes(file)));
        writeFileSync(ALLOWLIST, JSON.stringify(kept, null, 2) + '\n');
        console.log(`Tenant email allow-list: pruned ${stale.length} stale entr${stale.length === 1 ? 'y' : 'ies'}; ${Object.keys(kept).length} kept. Entries are never ADDED by --update.`);
        process.exit(0);
    }

    console.log(
        `Tenant email resolution: ${matches} use(s) of services.email in ${usesByFile.size} of ${files.length} server files — ` +
        `${exempt} exempt (${Object.keys(allowlist).length} allow-listed files), ${violations.length} violation(s), ` +
        `${stale.length} stale allow-list entr${stale.length === 1 ? 'y' : 'ies'}.`,
    );
    if (stale.length) {
        console.log('  Allow-listed files that no longer use services.email (run with --update to prune):');
        for (const file of stale) console.log(`    ${file}`);
    }
    if (violations.length) {
        console.error('\nTenant email resolution gate FAILED — services.email used where the tenant may be unknown to DI:\n');
        for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.snippet}`);
        console.error(`
  A route that learns its tenant in the handler must ask for that tenant's service:
      const email = await c.var.services.emailFor(tenantId);
  A send that speaks for the deployment (no company) must say so:
      c.var.services.platformEmail()
  Only if this file's tenant is resolved BEFORE the DI middleware on every path
  (tenant JWT, tenant slug in the path, fixed tenant), add it to
  scripts/tenant-email-allowlist.json with that reason.
`);
        process.exit(1);
    }
}
