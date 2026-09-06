#!/usr/bin/env node
/**
 * Is the wrangler patch actually in the installed bundle?
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * `patches/wrangler+4.129.0.patch` fixes workers-sdk#15317: a transient
 * ProxyWorker error was rebuilt as an EMPTY `Error` and then classified as
 * fatal, so one dropped connection under CI load killed `wrangler dev` and
 * every test after it answered ECONNREFUSED. Measured on this repository: the
 * job failed three times out of four after the upgrade and passed on the
 * version before it.
 *
 * A patch is the one kind of dependency change that leaves NO trace anywhere a
 * person normally looks. `npm ls` shows 4.129.0 either way; package.json shows
 * 4.129.0 either way; the lockfile shows 4.129.0 either way. If `patch-package`
 * ever stops running -- a lost `postinstall`, an `--ignore-scripts` install, a
 * version bump that makes the patch no longer apply -- the tree silently
 * reverts to the broken behaviour and the only symptom is a CI job that starts
 * failing for reasons nobody connects to a patch.
 *
 * So this asserts the patched BEHAVIOUR is present in the bytes that will run,
 * and it is wired into the gate registry rather than left as a README note.
 *
 * ⚠️ It checks for the two edits, not for the patch file. A patch that applied
 * to the wrong place, or a future wrangler that already carries the upstream
 * fix under different text, both need a human to look -- and both show up here
 * as a failure rather than as a green run over a broken tree.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';

const require_ = createRequire(import.meta.url);

/** Each marker is a string the PATCHED bundle must contain. */
const MARKERS = [
    {
        find: 'event.reason.startsWith("Error inside ProxyWorker")',
        why: 'the ProxyController exemption that keeps a transient proxy error non-fatal',
    },
    {
        find: 'typeof cause.message === "string" ? cause.message : void 0',
        why: 'castErrorCause rebuilding the Error from the posted shape instead of an empty one',
    },
];

let bundlePath;
try {
    bundlePath = require_.resolve('wrangler/wrangler-dist/cli.js');
} catch {
    // Fall back to the conventional location so the failure names the real
    // problem rather than a resolution detail.
    bundlePath = 'node_modules/wrangler/wrangler-dist/cli.js';
}

if (!existsSync(bundlePath)) {
    console.error(`[wrangler-patch] cannot find ${bundlePath} — is wrangler installed?`);
    process.exit(1);
}

const version = (() => {
    try { return require_('wrangler/package.json').version; } catch { return 'unknown'; }
})();

const bundle = readFileSync(bundlePath, 'utf8');
const missing = MARKERS.filter((m) => !bundle.includes(m.find));

// Both numbers, every run. A gate that prints only failures cannot be told
// apart from one that examined nothing.
console.log(
    `[wrangler-patch] wrangler ${version} · ${MARKERS.length} marker(s) required · `
    + `${MARKERS.length - missing.length} present · ${missing.length} missing`,
);

if (missing.length > 0) {
    console.error('\nThe wrangler patch is NOT in the installed bundle:\n');
    for (const m of missing) console.error(`  ✗ ${m.why}`);
    console.error(
        '\nWithout it, one transient ProxyWorker error kills `wrangler dev` mid-run and every\n'
        + 'test after it fails with ECONNREFUSED — 40+ failures that are all one failure.\n\n'
        + 'Fix: `npm install` (patch-package runs from postinstall). If the patch no longer\n'
        + 'applies, wrangler moved: re-cut it against the new bundle, or drop it if upstream\n'
        + 'has fixed workers-sdk#15317 — and delete this gate in the same commit.\n',
    );
    process.exit(1);
}

console.log('[wrangler-patch] OK — the fix for workers-sdk#15317 is present.');
