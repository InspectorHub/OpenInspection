#!/usr/bin/env node
/**
 * Dependency-advisory gate (pre-push).
 *
 * WHY THIS EXISTS, given GitHub already runs Dependabot.
 *
 * Dependabot is a server-side scan, and its scan lags the advisory. Measured on
 * 2026-08-08 against this project's own alerts:
 *
 *   dompurify  advisory published 2026-08-07 15:30Z -> alert created 08-08 00:01Z   (8.5 hours)
 *   nanoid     advisory published 2026-07-29 15:31Z -> alert created 08-08 00:18Z   (10 days)
 *
 * A release that reads "Dependabot: 0 open" is therefore reading "GitHub has not
 * scanned this yet", not "there is nothing to find". On the same day, `npm audit`
 * against the official registry reported a HIGH advisory in two of the three
 * repositories while both showed zero open Dependabot alerts. This gate closes
 * that window by asking the registry directly, at push time.
 *
 * THE FAILURE MODE THIS GUARDS AGAINST IN ITSELF.
 *
 * "The audit found nothing" and "the audit could not look" produce the same empty
 * result. This project has repeatedly shipped gates that were blind to their own
 * subject, so this one refuses to report success unless it can prove it examined
 * a real dependency tree:
 *
 *   - the registry must return parseable JSON that is an audit report,
 *   - the report must account for a non-zero number of dependencies,
 *   - a transport error, a timeout, or an endpoint that does not implement audit
 *     is a FAILURE, never a pass.
 *
 * That last one is not hypothetical. This machine's npm registry is a mirror
 * (registry.npmmirror.com) that answers /-/npm/v1/security/* with
 * "[NOT_IMPLEMENTED]", so an audit run without an explicit --registry silently
 * checks nothing. The registry is pinned below for exactly that reason.
 *
 * Usage:
 *   node scripts/check-advisories.mjs [--level=high] [--registry=<url>]
 *
 * Escape hatch (offline, or the registry is down):
 *   SKIP_ADVISORY_AUDIT=1 git push
 * It prints a loud notice. It exists so a genuine outage does not wedge a push —
 * not so a red result can be waved through.
 */

import { execFileSync } from 'node:child_process';

const REGISTRY = argValue('--registry') ?? 'https://registry.npmjs.org';
const LEVEL = argValue('--level') ?? 'high';
const TIMEOUT_MS = Number(process.env.ADVISORY_AUDIT_TIMEOUT_MS ?? 90_000);

// Ordered weakest-first; everything at or above LEVEL fails the gate.
const ORDER = ['info', 'low', 'moderate', 'high', 'critical'];

function argValue(flag) {
    const hit = process.argv.slice(2).find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : undefined;
}

function die(message, detail) {
    console.error(`[advisories] FAIL — ${message}`);
    if (detail) console.error(String(detail).trim().split('\n').slice(0, 12).join('\n'));
    process.exit(1);
}

if (process.env.SKIP_ADVISORY_AUDIT === '1') {
    console.warn('[advisories] SKIPPED by SKIP_ADVISORY_AUDIT=1 — this push was NOT checked against the advisory database.');
    process.exit(0);
}

if (!ORDER.includes(LEVEL)) {
    die(`--level must be one of ${ORDER.join(', ')} (got "${LEVEL}")`);
}

// The registry is interpolated into a shell command below (see the spawn note),
// so it must be a real http(s) URL and nothing else.
try {
    const u = new URL(REGISTRY);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('protocol');
} catch {
    die(`--registry must be an http(s) URL (got "${REGISTRY}")`);
}

// npm audit exits NON-ZERO both when it finds vulnerabilities and when the
// request fails, so the exit code cannot distinguish them. Capture stdout and
// decide from the payload.
//
// `shell: true` is required, not cosmetic: npm on Windows is `npm.cmd`, and
// since Node 20 spawning a .cmd without a shell throws EINVAL. Without it this
// gate fails on every Windows push — for the wrong reason, which is no better
// than passing for the wrong reason. REGISTRY is URL-validated above because it
// reaches a shell here.
let raw;
try {
    raw = execFileSync(
        'npm',
        ['audit', '--json', `--registry=${REGISTRY}`],
        { encoding: 'utf8', timeout: TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'], shell: true },
    );
} catch (err) {
    if (err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT') {
        die(`the registry did not answer within ${TIMEOUT_MS}ms (${REGISTRY}). Offline? Re-run, or push with SKIP_ADVISORY_AUDIT=1 and say so.`);
    }
    raw = err.stdout ?? '';
    if (!raw) die(`could not run npm audit against ${REGISTRY}`, err.stderr ?? err.message);
}

let report;
try {
    report = JSON.parse(raw);
} catch {
    die(`${REGISTRY} did not return an audit report. A mirror that does not implement /-/npm/v1/security/* answers here, and an unparsed answer is NOT a clean result.`, raw);
}

if (report.error) {
    die(`the registry refused the audit request (${REGISTRY}).`, JSON.stringify(report.error));
}

// Anti-blindness: an audit that examined nothing looks exactly like an audit
// that found nothing. Demand evidence that a real tree was walked.
const depTotal = report?.metadata?.dependencies?.total;
if (typeof depTotal !== 'number' || depTotal <= 0) {
    die('the report accounts for zero dependencies, so it did not examine this project. Refusing to report success on an empty scan.', raw.slice(0, 800));
}

const counts = report?.metadata?.vulnerabilities;
if (!counts || typeof counts.total !== 'number') {
    die('the report carries no vulnerability tally, so its shape is not one this gate understands.', raw.slice(0, 800));
}

const threshold = ORDER.indexOf(LEVEL);
const offending = ORDER.slice(threshold).filter((s) => (counts[s] ?? 0) > 0);
const offendingTotal = offending.reduce((n, s) => n + counts[s], 0);

if (offendingTotal === 0) {
    const below = ORDER.slice(0, threshold).map((s) => `${s} ${counts[s] ?? 0}`).join(', ');
    console.log(`[advisories] OK — ${depTotal} dependencies checked against ${REGISTRY}; nothing at or above "${LEVEL}". Below threshold: ${below}.`);
    process.exit(0);
}

console.error(`[advisories] FAIL — ${offendingTotal} advisory/advisories at or above "${LEVEL}" (${depTotal} dependencies checked).`);
for (const [name, v] of Object.entries(report.vulnerabilities ?? {})) {
    if (ORDER.indexOf(v.severity) < threshold) continue;
    const via = (v.via ?? []).find((x) => typeof x === 'object');
    console.error(`  - ${name} ${v.range ?? ''} [${v.severity}] ${via?.title ?? ''}`);
    if (via?.url) console.error(`      ${via.url}`);
    if (v.isDirect === false) console.error('      transitive — a direct `npm update <pkg>` may already be in range; otherwise add an npm "overrides" entry');
}
console.error('');
console.error('⚠️  Do NOT fix this by deleting package-lock.json on Windows: re-resolving drops the');
console.error('    linux binaries and breaks the ubuntu runner. Update in place and check the count');
console.error('    of "linux" entries in the lockfile is unchanged.');
process.exit(1);
