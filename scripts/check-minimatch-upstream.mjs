#!/usr/bin/env node
/**
 * Upstream watch for the minimatch advisory (GHSA-g3hv-75wg-m249, minimatch before 11.0.1).
 *
 * Read-only and not a gate: nothing here runs on the commit or push ladder. A weekly workflow
 * (.github/workflows/dependency-watch.yml) runs it and turns exit codes 10 and 11 into a failed run: that red run is the signal.
 *
 * It reads package-lock.json, lists every package that depends on a minimatch older than 11.0.1,
 * asks the npm registry (https://registry.npmjs.org only) for the `latest` metadata of each, and
 * reports the minimatch range that release declares and whether that range admits 11.0.1 or later.
 *
 * Exit codes. The signals are 10 and 11, not 1, so that a raw Node crash (a syntax error, a missing module, an unsupported
 * runtime), which exits 1, is never mistaken for one:
 *   0    not ready: at least one holder does not admit a patched minimatch, or could not be checked. A failed
 *        fetch prints UNKNOWN and never counts as admitting: the answer fails closed to "not ready".
 *   10   READY: every holder's latest release admits a patched minimatch. Remove the overrides and close the alert
 *        (docs/develop/dependency-policy.md says how).
 *   11   DONE: no package depending on a minimatch older than 11.0.1 remains in the lockfile. Close the alert and
 *        delete this watch and its workflow.
 *   2    the watch itself failed (unreadable lockfile, an unexpected error): the message on the last line says which.
 *   Anything else is a failure of the runtime, not an answer.
 *
 * `--lock <path>` reads another lockfile (used by the unit spec).
 *
 * A declared range admitting 11 does not prove the tool calls minimatch 11 correctly (minimatch 11
 * exports no callable default, and some plugins call it as a function), so "ready" means "worth
 * trying the upgrade", not "safe".
 *
 * No dependencies; Node 22 global fetch. console.* is intentional: this is a script, not server code.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REGISTRY = 'https://registry.npmjs.org';
const PATCHED = [11, 0, 1];
/** Versions tried against a declared range: the first patched release, the newest at the time of writing, and later lines. */
const CANDIDATES = ['11.0.1', '11.0.4', '11.99.0', '12.0.0'];

/** "1.2.3" to [1, 2, 3]; anything else to null. */
export function parseVersion(text) {
    const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(String(text).trim());
    return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

export function compareVersions(a, b) {
    for (let i = 0; i < 3; i += 1) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
    return 0;
}

/** True when `version` is older than the first patched release (11.0.1). */
export function isBelowPatched(version) {
    const v = parseVersion(version);
    return v !== null && compareVersions(v, PATCHED) < 0;
}

/** Fills missing parts of a partial version ("1", "1.2", "1.x", "*") and says which parts were given. */
function partial(text) {
    // A prerelease suffix (11.0.0-beta.1) is ignored for the numeric comparison.
    const parts = text.replace(/^v/, '').replace(/-.*$/, '').split('.');
    const given = parts.map((p) => (p === '' || p === 'x' || p === 'X' || p === '*' ? null : Number(p)));
    if (given.some((p) => p !== null && Number.isNaN(p))) return null;
    const count = given.findIndex((p) => p === null);
    const specified = count === -1 ? given.length : count;
    return { v: [given[0] ?? 0, given[1] ?? 0, given[2] ?? 0], specified };
}

/** One comparator such as "^10.2.4", "~3.1", ">=9", "1.x" or "*", evaluated against a parsed version. */
function satisfiesComparator(version, token) {
    const m = /^(\^|~|>=|<=|>|<|=)?\s*(.*)$/.exec(token);
    const op = m[1] ?? '';
    // A bare operator with nothing after it is not a range.
    if (m[2] === '') return false;
    const p = partial(m[2]);
    if (p === null) return false;
    const { v, specified } = p;
    if (specified === 0) return true;
    switch (op) {
        case '^': {
            if (compareVersions(version, v) < 0) return false;
            const upper = v[0] > 0 || specified === 1 ? [v[0] + 1, 0, 0] : v[1] > 0 || specified === 2 ? [0, v[1] + 1, 0] : [0, 0, v[2] + 1];
            return compareVersions(version, upper) < 0;
        }
        case '~': {
            if (compareVersions(version, v) < 0) return false;
            return compareVersions(version, specified === 1 ? [v[0] + 1, 0, 0] : [v[0], v[1] + 1, 0]) < 0;
        }
        case '>=': return compareVersions(version, v) >= 0;
        case '>': return compareVersions(version, specified === 3 ? v : specified === 2 ? [v[0], v[1] + 1, 0] : [v[0] + 1, 0, 0]) >= (specified === 3 ? 1 : 0);
        case '<=': return compareVersions(version, specified === 3 ? v : specified === 2 ? [v[0], v[1] + 1, 0] : [v[0] + 1, 0, 0]) <= (specified === 3 ? 0 : -1);
        case '<': return compareVersions(version, v) < 0;
        default: {
            // exact or x-range: every specified part must match
            for (let i = 0; i < specified; i += 1) if (version[i] !== v[i]) return false;
            return true;
        }
    }
}

/** Does a semver range (alternatives joined by ||, comparators by spaces) admit this version? Unparseable ranges admit nothing. */
export function rangeAdmits(range, versionText) {
    const version = parseVersion(versionText);
    if (version === null || typeof range !== 'string') return false;
    return range.split('||').some((set) => {
        // A hyphen range "1.2.3 - 2.0.0" is ">=1.2.3 <=2.0.0"; a workspace: or other non-semver range matches nothing.
        const tokens = set.trim().replace(/(\S+)\s+-\s+(\S+)/, '>=$1 <=$2').replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/).filter(Boolean);
        return tokens.length > 0 && tokens.every((t) => satisfiesComparator(version, t));
    });
}

/** True when the declared range admits a patched minimatch (11.0.1 or later). Undefined or unreadable ranges admit nothing. */
export function admitsPatched(range) {
    return CANDIDATES.some((v) => rangeAdmits(range, v));
}

/** The package name of a lockfile path such as "node_modules/a/node_modules/@s/b". */
function nameOfPath(path) {
    const i = path.lastIndexOf('node_modules/');
    return i === -1 ? '' : path.slice(i + 'node_modules/'.length);
}

/**
 * Every installed package that depends on a minimatch older than 11.0.1, resolved the way node resolves it
 * (the package's own node_modules first, then each parent's). Sorted by name, one entry per name.
 */
export function holdersOf(lock) {
    const packages = lock.packages ?? {};
    const found = new Map();
    for (const [path, info] of Object.entries(packages)) {
        if (path === '' || !info.dependencies || !('minimatch' in info.dependencies)) continue;
        let dir = path;
        let resolved = null;
        for (;;) {
            const candidate = packages[`${dir}/node_modules/minimatch`] ?? (dir === '' ? packages['node_modules/minimatch'] : undefined);
            if (candidate) { resolved = candidate; break; }
            const up = dir.lastIndexOf('/node_modules/');
            if (up === -1) { resolved = packages['node_modules/minimatch'] ?? null; break; }
            dir = dir.slice(0, up);
        }
        if (resolved && isBelowPatched(resolved.version)) {
            const name = nameOfPath(path);
            if (!found.has(name)) found.set(name, { name, installed: info.version, minimatch: resolved.version });
        }
    }
    return [...found.values()].sort((a, b) => (a.name < b.name ? -1 : 1));
}

/** Combines per-holder results into the report numbers and the exit code. A holder with no answer is never counted as admitting. */
export function summarize(results) {
    const holders = results.length;
    const admits = results.filter((r) => r.status === 'ok' && r.admits).length;
    const unknown = results.filter((r) => r.status !== 'ok').length;
    // `done` means nothing depends on a minimatch older than 11.0.1 any more: there is nothing left to watch.
    return { holders, admits, unknown, ready: holders > 0 && admits === holders, done: holders === 0 };
}

async function latestOf(name, fetchImpl) {
    const url = `${REGISTRY}/${name.replaceAll('/', '%2f')}/latest`;
    try {
        const res = await fetchImpl(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
        if (!res.ok) return { status: 'error' };
        const meta = await res.json();
        // A 200 that is not the package's metadata (an empty object, an array, null, another package) is no answer: it must not read
        // as "no longer depends on minimatch".
        if (meta === null || typeof meta !== 'object' || Array.isArray(meta) || typeof meta.version !== 'string' || (typeof meta.name === 'string' && meta.name !== name)) return { status: 'error' };
        const range = meta.dependencies?.minimatch ?? meta.peerDependencies?.minimatch ?? meta.optionalDependencies?.minimatch ?? null;
        // A release that no longer depends on minimatch at all cannot hold a copy older than the patched release: that counts as admitting.
        return { status: 'ok', latest: meta.version, range, admits: range === null ? true : admitsPatched(range) };
    } catch {
        return { status: 'error' };
    }
}

export async function watch(lock, fetchImpl = fetch) {
    const holders = holdersOf(lock);
    const results = await Promise.all(holders.map(async (h) => ({ ...h, ...(await latestOf(h.name, fetchImpl)) })));
    return { results, summary: summarize(results) };
}

function table(results) {
    const rows = [['tool', 'installed', 'minimatch', 'latest', 'declared range', 'admits >= 11.0.1']];
    for (const r of results) {
        rows.push([r.name, r.installed, r.minimatch, r.status === 'ok' ? r.latest : 'UNKNOWN', r.status === 'ok' ? (r.range ?? '(dropped)') : 'UNKNOWN', r.status === 'ok' ? (r.admits ? 'yes' : 'no') : 'UNKNOWN']);
    }
    const widths = rows[0].map((_, i) => Math.max(...rows.map((row) => String(row[i]).length)));
    return rows.map((row) => row.map((cell, i) => String(cell).padEnd(widths[i])).join('  ')).join('\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        const flag = process.argv.indexOf('--lock');
        const lockPath = flag !== -1 && process.argv[flag + 1] ? process.argv[flag + 1] : fileURLToPath(new URL('../package-lock.json', import.meta.url));
        const { results, summary } = await watch(JSON.parse(readFileSync(lockPath, 'utf8')));
        console.log(table(results));
        console.log(`\n[minimatch-watch] ${summary.admits} of ${summary.holders} holder(s) admit minimatch >= 11.0.1 in their latest release; ${summary.unknown} unknown.`);
        if (summary.done) {
            console.log('[minimatch-watch] DONE: no package depending on a minimatch older than 11.0.1 remains in the lockfile. Close the alert and delete this watch and its workflow.');
            process.exit(11);
        }
        if (summary.ready) {
            console.log('[minimatch-watch] READY: every holder admits a patched minimatch. Remove the overrides and close the alert (docs/develop/dependency-policy.md).');
            process.exit(10);
        }
        console.log('[minimatch-watch] not ready: at least one holder does not admit a patched minimatch, or could not be checked.');
    } catch (err) {
        console.error(`[minimatch-watch] ERROR: the watch itself failed (${err instanceof Error ? err.message : String(err)}). This is not the ready signal.`);
        process.exit(2);
    }
}
