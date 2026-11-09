#!/usr/bin/env node
/**
 * Gate: every spec listed under `shared` in tests/unit/isolation.json may
 * really share a module registry.
 *
 * `api-shared` runs with `isolate: false` (see vitest.api.config.ts), so a spec
 * in that list that mocks a module, writes a global, or reaches a module that
 * keeps state would leak into whichever spec the same worker runs next, and the
 * damage would show up in a different file than the one that caused it. This
 * gate reads the same rules the manifest generator used
 * (scripts/lib/unit-isolation.mjs) and fails when a listed spec breaks one, when
 * a listed file no longer exists, or when the list is empty (a gate that checked
 * nothing would be green forever).
 *
 * A failing spec is fixed by removing it from `shared` and recording it under
 * `forcedIsolated` with the reason (or by running `node
 * scripts/gen-unit-isolation.mjs`, which re-derives the list from the rules).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exemptStateProblems, setupProblems, sharedProblems } from './lib/unit-isolation.mjs';

/** Pure: returns { errors, shared, total }. `specsOnDisk` is the list of every api unit spec. */
export function checkManifest(root, manifest, specsOnDisk) {
    const errors = [];
    const shared = manifest.shared ?? [];
    const forced = manifest.forcedIsolated ?? {};
    if (shared.length === 0) errors.push('tests/unit/isolation.json lists no shared specs; refusing to report OK on an empty list');
    const onDisk = new Set(specsOnDisk);
    const seen = new Set();
    const graph = new Map();
    for (const s of shared) {
        if (seen.has(s)) errors.push(`${s}: listed twice`);
        seen.add(s);
        if (!onDisk.has(s)) {
            errors.push(`${s}: listed under shared but not a spec in tests/unit`);
            continue;
        }
        if (forced[s]) errors.push(`${s}: is both shared and forcedIsolated (${forced[s]})`);
        for (const p of new Set(sharedProblems(root, s, graph))) errors.push(`${s}: ${p}`);
    }
    for (const [s, why] of Object.entries(forced)) {
        if (!onDisk.has(s)) errors.push(`${s}: forcedIsolated entry names no spec`);
        if (!String(why).trim()) errors.push(`${s}: forcedIsolated entry has no reason`);
    }
    return { errors, shared: shared.length, total: specsOnDisk.length };
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href) {
    const root = process.cwd();
    const { listSpecs } = await import('./lib/list-unit-specs.mjs');
    const manifestPath = join(root, 'tests/unit/isolation.json');
    if (!existsSync(manifestPath)) {
        console.error('tests/unit/isolation.json is missing; run node scripts/gen-unit-isolation.mjs');
        process.exit(1);
    }
    const cfg = readFileSync(join(root, 'vitest.api.config.ts'), 'utf8');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
    const specs = listSpecs(root);
    const { errors, shared, total } = checkManifest(root, manifest, specs);
    errors.push(...setupProblems(root), ...exemptStateProblems(root));
    if (!cfg.includes('isolation.json')) errors.push('vitest.api.config.ts does not read tests/unit/isolation.json, so the list decides nothing');
    if (errors.length) {
        console.error(`Unit-isolation violations (${errors.length}):\n  ${errors.join('\n  ')}`);
        console.error(`\nFix: node scripts/gen-unit-isolation.mjs  (shared ${shared} of ${total} specs)`);
        process.exit(1);
    }
    // Advisory, not a failure: a spec the rules accept that nobody listed runs isolated (slower, never wrong),
    // so a new spec must not break the build. Printing it keeps the manifest from drifting unnoticed.
    const listed = new Set([...(manifest.shared ?? []), ...Object.keys(manifest.forcedIsolated ?? {})]);
    const graph = new Map();
    const unlisted = specs.filter((s) => !listed.has(s) && sharedProblems(root, s, graph).length === 0);
    if (unlisted.length) {
        console.log(`note: ${unlisted.length} spec(s) pass every rule but are not in the manifest, so they run isolated; run node scripts/gen-unit-isolation.mjs:`);
        for (const s of unlisted) console.log(`  ${s}`);
    }
    console.log(`unit isolation OK (shared ${shared}, isolated ${total - shared}, of ${total} specs)`);
}
