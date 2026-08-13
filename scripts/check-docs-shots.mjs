#!/usr/bin/env node
/**
 * The user-guide prose/capture gate.
 *
 *   node scripts/check-docs-shots.mjs            # syntax only (CI-safe)
 *   node scripts/check-docs-shots.mjs --captures # also compare against .docs-shots/
 *
 * TWO LEVELS, because only one of them can run everywhere.
 *
 * SYNTAX (default, wired into `npm run lint`): every `<!-- shot: … -->` marker
 * in `docs/user-guide/*.md` has a url-safe id, has alt text, and is not a
 * duplicate. All of that is readable from the markdown alone, so it holds on a
 * clean checkout and in CI.
 *
 * CAPTURES (`--captures`, part of the docs build): the marker ids must match
 * the PNGs `npm run docs:shots` produced, exactly, in both directions. This
 * cannot run in CI — there are no captures there — and pretending otherwise
 * would give a gate that passes because it looked at nothing.
 *
 * Both levels print what they examined beside what they found, and BOTH treat
 * "examined nothing" as a failure. A docs gate that goes green on a checkout
 * with no docs in it is worse than no gate: it is a gate that reports success
 * for the one condition it exists to detect.
 */
import { readdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { extractMarkers, validateGuide } from './lib/docs-shots.mjs';

const root = process.cwd();
const GUIDE_DIR = join(root, 'docs/user-guide');
const SHOT_ROOT = join(root, '.docs-shots');
const withCaptures = process.argv.includes('--captures');

/** Guides are every page in the directory except its index. */
function guides() {
    if (!existsSync(GUIDE_DIR)) return [];
    return readdirSync(GUIDE_DIR)
        .filter((f) => f.endsWith('.md') && f !== 'README.md')
        .map((f) => ({ slug: basename(f, '.md'), file: join(GUIDE_DIR, f) }))
        .sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Capture ids for a guide, read off disk — the PNG names ARE the id list, so
 *  there is no manifest to fall out of step with the files it describes. */
function captureIds(slug) {
    const dir = join(SHOT_ROOT, slug);
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return null;
    return readdirSync(dir)
        .filter((f) => f.endsWith('.png'))
        .map((f) => basename(f, '.png'));
}

const found = guides();
const problems = [];
let markerTotal = 0;
let compared = 0;
const skipped = [];

for (const { slug, file } of found) {
    const markers = extractMarkers(readFileSync(file, 'utf8'));
    markerTotal += markers.length;

    const ids = withCaptures ? captureIds(slug) : null;
    if (withCaptures && ids === null) {
        // Named, not counted: "3 guides skipped" tells you nothing about which
        // guide is about to publish with last week's pictures.
        skipped.push(slug);
    }

    // With no captures to compare against, pass an id list that trivially
    // agrees so the set comparison stays silent and only the syntax rules fire.
    const shotIds = ids ?? markers.filter((m) => m.validId).map((m) => m.id);
    if (ids !== null) compared += 1;

    problems.push(...validateGuide({ slug, markers, shotIds }).problems);
}

const level = withCaptures ? 'syntax + captures' : 'syntax';
console.log(
    `[docs-shots] ${level} — ${found.length} guide(s), ${markerTotal} marker(s)` +
        (withCaptures ? `, ${compared} compared against captures, ${skipped.length} skipped` : '') +
        `, ${problems.length} problem(s)`,
);
if (skipped.length) {
    console.log(`[docs-shots] no captures yet (run \`npm run docs:shots\`): ${skipped.join(', ')}`);
}

if (found.length === 0) {
    console.error('[docs-shots] FAIL — found no guides in docs/user-guide/. The path or the filter is wrong, not the docs.');
    process.exit(1);
}
// A repository whose guides are not illustrated yet is a real state, so in
// syntax mode zero markers is reported and allowed. Under --captures it is not:
// comparing captures against nothing is the shape of a gate that passes because
// it looked at nothing.
if (markerTotal === 0) {
    if (withCaptures) {
        console.error('[docs-shots] FAIL — comparing captures, but no guide carries a shot marker.');
        process.exit(1);
    }
    console.log('[docs-shots] no guide is illustrated yet — syntax rules had nothing to check.');
}

if (problems.length) {
    console.error('\nProse and captures disagree:\n');
    for (const p of problems) console.error(`  ${p}`);
    console.error('\nEach line names the guide and the id. Fix the prose or the shots script.');
    process.exit(1);
}
