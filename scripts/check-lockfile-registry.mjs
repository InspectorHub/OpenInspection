#!/usr/bin/env node
/**
 * Lockfile registry guard.
 *
 * Fails (exit 1) when `package-lock.json` records a `resolved` tarball URL on
 * any host but the public npm registry.
 *
 * ## Why this is a gate and not a note
 *
 * Whichever registry you install from is the one npm writes into every
 * `resolved` field, and it does so silently. A contributor behind a regional
 * mirror produces a correct, working lockfile whose URLs point at that mirror,
 * and nothing in the normal loop complains -- the install succeeded, the tests
 * pass, the diff looks like noise in a file nobody reads line by line.
 *
 * This is a PUBLIC repository. Its lockfile is what every contributor and the
 * CI runner install from, so a mirror host committed here sends them all to an
 * origin they did not choose and may not be able to reach. Measured 2026-09-09:
 * 843 of 1024 entries had drifted onto one, accumulated over an unknown number
 * of ordinary commits, and the only reason it surfaced at all was someone
 * reading the file for an unrelated reason.
 *
 * ## What it does NOT do
 *
 * It does not tell you which registry to install FROM. Installing through a
 * mirror is faster on many networks and is nobody's business but yours; the
 * tarballs are byte-identical, which is why the fix below is a safe textual
 * substitution rather than a re-resolve. The invariant is only about what gets
 * COMMITTED.
 *
 * Do not "fix" a failure by deleting the lockfile and reinstalling. On Windows
 * that re-resolves optional dependencies for the host platform only and drops
 * the linux binaries the ubuntu CI runner needs -- swapping a cosmetic problem
 * for a broken build.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The one host a published lockfile may name. */
export const OFFICIAL_HOST = 'registry.npmjs.org';

/**
 * Pull the host out of every `resolved` URL in a parsed lockfile.
 *
 * Entries with no `resolved` are normal and are not findings: the root project,
 * workspace links, and anything resolved from disk all legitimately lack one.
 * They are counted so the report can never quietly examine nothing.
 */
export function collectHosts(lock) {
    const packages = (lock && lock.packages) || {};
    const withUrl = [];
    let withoutUrl = 0;
    for (const [path, pkg] of Object.entries(packages)) {
        const url = pkg && pkg.resolved;
        if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
            withoutUrl += 1;
            continue;
        }
        let host;
        try {
            host = new URL(url).host;
        } catch {
            host = '(unparseable)';
        }
        withUrl.push({ path, url, host });
    }
    return { withUrl, withoutUrl };
}

/** Group the offending entries by host, so the report names the destination. */
export function offendersByHost(withUrl, official = OFFICIAL_HOST) {
    const byHost = new Map();
    for (const e of withUrl) {
        if (e.host === official) continue;
        if (!byHost.has(e.host)) byHost.set(e.host, []);
        byHost.get(e.host).push(e.path);
    }
    return byHost;
}

function main() {
    const lockPath = join(ROOT, 'package-lock.json');
    if (!existsSync(lockPath)) {
        console.error('[lockfile-registry] package-lock.json not found — refusing to report a pass.');
        process.exit(1);
    }

    let lock;
    try {
        lock = JSON.parse(readFileSync(lockPath, 'utf8'));
    } catch (e) {
        console.error(`[lockfile-registry] could not parse package-lock.json: ${e.message}`);
        process.exit(1);
    }

    const { withUrl, withoutUrl } = collectHosts(lock);

    // A lockfile this gate cannot read is not a lockfile that passes. Zero
    // examined entries means the shape changed under us, not that all is well.
    if (withUrl.length === 0) {
        console.error('[lockfile-registry] no `resolved` URLs found at all — the lockfile shape is not what '
            + 'this gate knows how to read. Refusing to report a pass on a file it did not measure.');
        process.exit(1);
    }

    const byHost = offendersByHost(withUrl);
    const bad = [...byHost.values()].reduce((n, list) => n + list.length, 0);

    console.log('[lockfile-registry]');
    console.log(`  resolved URLs examined : ${withUrl.length}`);
    console.log(`  on ${OFFICIAL_HOST}   : ${withUrl.length - bad}`);
    console.log(`  on another host        : ${bad}`);
    console.log(`  entries with no URL    : ${withoutUrl} (root, links, file: deps — not findings)`);

    if (bad === 0) {
        console.log(`  OK — every resolved URL names ${OFFICIAL_HOST}.`);
        return;
    }

    console.error('\n  ✘ this is a public repository; its lockfile is what contributors and CI install from.');
    for (const [host, paths] of byHost) {
        console.error(`\n  ${host} — ${paths.length} entr${paths.length === 1 ? 'y' : 'ies'}, first few:`);
        for (const p of paths.slice(0, 5)) console.error(`      ${p}`);
        if (paths.length > 5) console.error(`      … and ${paths.length - 5} more`);
    }
    console.error(`\n  Fix — a textual substitution, NOT a reinstall. The tarballs are byte-identical,`);
    console.error(`  so only the host changes and every integrity hash still verifies:`);
    for (const host of byHost.keys()) {
        console.error(`      sed -i 's|https://${host}/|https://${OFFICIAL_HOST}/|g' package-lock.json`);
    }
    console.error(`\n  Then confirm with \`npm ci\`. Do NOT delete the lockfile and reinstall: on Windows`);
    console.error('  that re-resolves optional deps for the host platform and drops the linux binaries CI needs.');
    process.exit(1);
}

main();
