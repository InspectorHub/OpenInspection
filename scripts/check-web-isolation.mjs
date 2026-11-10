#!/usr/bin/env node
/**
 * Gate: every spec listed under `shared` in tests/web-isolation.json may really share a module
 * registry.
 *
 * `web-node-shared` and `web-dom-shared` run with `isolate: false` (see vitest.config.ts), so a spec
 * in either list that mocks a module, writes a global, leaves a mount behind or reaches a module that
 * keeps state would leak into whichever spec the same worker runs next, and the damage would show up
 * in a different file than the one that caused it. This gate reads the same rules the manifest
 * generator used (scripts/lib/web-isolation.mjs) and fails when a listed spec breaks one, when a
 * spec sits in the project of the wrong environment (its docblock disagrees), when an entry is listed
 * twice or in both lists, when a listed file no longer exists, or when a list is empty (a gate that
 * checked nothing would be green forever).
 *
 * A failing spec is fixed by removing it from `shared` and recording it under `forcedIsolated` with
 * the reason (or by running `node scripts/gen-web-isolation.mjs`, which re-derives the lists from the
 * rules).
 *
 * A few hazards (fake timers, localStorage writes) are accepted in a shared spec because tests/setup-web.ts undoes
 * them after every test; this gate also fails when that reset is removed (SETUP_RESETS in scripts/lib/web-isolation.mjs).
 *
 * `npm run lint:web-isolation` runs this through check-test-isolation.mjs
 * (`--only web-isolation`) beside the unit check. This file still runs on its own.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { listWebSpecs, setupResetProblems, webSharedProblems } from './lib/web-isolation.mjs';

/** The environment each shared list runs in. */
const LIST_ENV = { node: 'node', dom: 'happy-dom' };

/** Pure: returns { errors, shared, total }. `specsOnDisk` is the list of every web spec. */
export function checkManifest(root, manifest, specsOnDisk) {
    const errors = [];
    const shared = manifest.shared ?? {};
    const forced = manifest.forcedIsolated ?? {};
    const onDisk = new Set(specsOnDisk);
    const seen = new Map();
    const graph = new Map();
    let count = 0;
    for (const [list, env] of Object.entries(LIST_ENV)) {
        const specs = shared[list] ?? [];
        if (specs.length === 0) errors.push(`tests/web-isolation.json lists no shared.${list} specs; refusing to report OK on an empty list`);
        for (const s of specs) {
            count += 1;
            if (seen.has(s)) errors.push(`${s}: listed twice (shared.${seen.get(s)} and shared.${list})`);
            seen.set(s, list);
            if (!onDisk.has(s)) {
                errors.push(`${s}: listed under shared.${list} but not a web spec on disk`);
                continue;
            }
            if (forced[s]) errors.push(`${s}: is both shared and forcedIsolated (${forced[s]})`);
            const { env: declared, problems } = webSharedProblems(root, s, graph);
            if (declared !== env) errors.push(`${s}: listed under shared.${list} (${env}) but its docblock asks for ${declared}`);
            for (const p of new Set(problems)) errors.push(`${s}: ${p}`);
        }
    }
    for (const list of Object.keys(shared)) {
        if (!(list in LIST_ENV)) errors.push(`tests/web-isolation.json: unknown list shared.${list}`);
    }
    for (const [s, why] of Object.entries(forced)) {
        if (!onDisk.has(s)) errors.push(`${s}: forcedIsolated entry names no spec`);
        if (!String(why).trim()) errors.push(`${s}: forcedIsolated entry has no reason`);
    }
    return { errors, shared: count, total: specsOnDisk.length };
}

/**
 * The CLI body. Called by the guard below and by check-test-isolation.mjs, which
 * runs the unit and web isolation checks in one process.
 */
export async function run() {
    const root = process.cwd();
    const manifestPath = join(root, 'tests/web-isolation.json');
    if (!existsSync(manifestPath)) {
        console.error('tests/web-isolation.json is missing; run node scripts/gen-web-isolation.mjs');
        process.exit(1);
    }
    const cfg = readFileSync(join(root, 'vitest.config.ts'), 'utf8');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const specs = listWebSpecs(root);
    const { errors, shared, total } = checkManifest(root, manifest, specs);
    errors.push(...setupResetProblems(root));
    if (!cfg.includes('web-isolation.json')) errors.push('vitest.config.ts does not read tests/web-isolation.json, so the lists decide nothing');
    if (errors.length) {
        console.error(`Web-isolation violations (${errors.length}):\n  ${errors.join('\n  ')}`);
        console.error(`\nFix: node scripts/gen-web-isolation.mjs  (shared ${shared} of ${total} specs)`);
        process.exit(1);
    }
    // Advisory, not a failure: a spec the rules accept that nobody listed runs isolated (slower, never wrong),
    // so a new spec must not break the build. Printing it keeps the manifest from drifting unnoticed.
    const listed = new Set([...manifest.shared.node, ...manifest.shared.dom, ...Object.keys(manifest.forcedIsolated ?? {})]);
    const graph = new Map();
    const unlisted = specs.filter((s) => !listed.has(s) && webSharedProblems(root, s, graph).problems.length === 0);
    if (unlisted.length) {
        console.log(`note: ${unlisted.length} spec(s) pass every rule but are not in the manifest, so they run isolated; run node scripts/gen-web-isolation.mjs:`);
        for (const s of unlisted) console.log(`  ${s}`);
    }
    console.log(`web isolation OK (shared ${shared}: node ${manifest.shared.node.length}, dom ${manifest.shared.dom.length}; isolated ${total - shared}, of ${total} specs)`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
    await run();
}
