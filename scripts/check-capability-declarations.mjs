#!/usr/bin/env node
/**
 * Capability declaration gate (Task 15, two-layer role model).
 *
 * A route that mounts requireCapability('X') must also declare it in its
 * withMcpMetadata meta as `capability: 'X'`, and vice versa. The runtime
 * authorization-surface spec (tests/unit/platform/authorization-surface.spec.ts)
 * proves the same agreement against the LIVE route registry, but it runs late
 * (full test suite / CI); this catches the drift at commit, in the file being
 * edited, where it is cheapest to fix. The two are complementary: this script
 * sees one file and cannot know the registry; the spec sees the registry and
 * cannot point at the line you just typed.
 *
 * Pairing model: each `createRoute(withMcpMetadata(` occurrence opens a window
 * that runs to the next occurrence (or EOF). Within a window, the multiset of
 * `requireCapability('X')` mounts must equal the multiset of `capability: 'X'`
 * declarations. A window belongs to exactly one route definition because the
 * repo's route files declare one createRoute per const.
 *
 * console.* is intentional — this is a build script, not server code.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const SCAN_DIR = join(ROOT, 'server', 'api');

function walkFiles(dir, out = []) {
    for (const entry of readdirSync(dir)) {
        const p = join(dir, entry);
        const st = statSync(p);
        if (st.isDirectory()) walkFiles(p, out);
        else if (/\.ts$/.test(p) && !/\.(test|spec)\.ts$/.test(p)) out.push(p);
    }
    return out;
}

const OPEN = 'createRoute(withMcpMetadata(';
const failures = [];

/**
 * Blank out comment bodies, preserving length and newlines.
 *
 * The scan is textual, so a comment EXPLAINING a route's gating — "Gated on
 * `requireCapability('scheduleOthers')`, matching the write it feeds" — counted
 * as a mount, and got attributed to whichever route began above it. That is a
 * false positive on prose, and a gate that fires on prose is one people learn to
 * bypass. Replacing with spaces rather than deleting keeps every byte offset
 * valid, which the line-number arithmetic below depends on.
 */
function blankComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, (m) => m.replace(/[^\n]/g, ' '));
}

for (const file of walkFiles(SCAN_DIR)) {
    const rel = relative(ROOT, file).replace(/\\/g, '/');
    const source = blankComments(readFileSync(file, 'utf8'));
    const starts = [];
    for (let i = source.indexOf(OPEN); i !== -1; i = source.indexOf(OPEN, i + 1)) starts.push(i);
    for (let w = 0; w < starts.length; w++) {
        const windowSrc = source.slice(starts[w], starts[w + 1] ?? source.length);
        const mounted = [...windowSrc.matchAll(/requireCapability\(\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
        const declared = [...windowSrc.matchAll(/\bcapability:\s*'([A-Za-z]+)'/g)].map((m) => m[1]);
        const line = source.slice(0, starts[w]).split('\n').length;
        for (const cap of mounted) {
            if (!declared.includes(cap)) {
                failures.push(`${rel}:${line} mounts requireCapability('${cap}') but its withMcpMetadata meta does not declare capability: '${cap}'`);
            }
        }
        for (const cap of declared) {
            if (!mounted.includes(cap)) {
                failures.push(`${rel}:${line} declares capability: '${cap}' but does not mount requireCapability('${cap}')`);
            }
        }
    }
}

if (failures.length > 0) {
    console.error('\nCapability-declaration gate FAILED:\n');
    for (const f of failures) console.error(`  ${f}`);
    console.error(
        '\n  A route that mounts requireCapability must declare the same capability in\n' +
        "  its withMcpMetadata meta ({ scopes, tier, capability: '<name>' }), and a\n" +
        '  declared capability must actually be mounted. The authorization-surface\n' +
        '  spec asserts the same agreement against the live registry.\n',
    );
    process.exit(1);
}
console.log('Capability-declaration gate: OK.');
