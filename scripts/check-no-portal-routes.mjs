#!/usr/bin/env node
/**
 * The portal-route gate: no hosted-service URL may appear as a bare path in
 * this repository's markdown.
 *
 *   node scripts/check-no-portal-routes.mjs
 *
 * Why, what counts as a hit, and what does not, all live in
 * `scripts/lib/no-portal-routes.mjs` beside the pattern they describe. The
 * short version: this engine is AGPL and self-hosted by other people, a hosted
 * screen is not reachable in their deployment, and `/company/acme/team` in
 * prose is a promise this software cannot keep. Link to it absolutely
 * (`https://inspectorhub.io/…`) and it is fine.
 *
 * ⚠️ THIS GATE GREPS PROSE, so it can be right about the words and wrong about
 * the meaning. The usual case is a NEGATIVE statement — explaining that we
 * deliberately do not document a hosted screen requires naming it — and a
 * content grep cannot tell that from an instruction. Two escape hatches, both
 * requiring a reason:
 *
 *     <!-- no-portal-routes-allow: <reason> -->        that line only
 *     <!-- no-portal-routes-allow-file: <reason> -->   the whole file
 *
 * Both numbers print on every run: files scanned and hits found. Zero files
 * scanned is a FAILURE — it means the pathspec is broken, not that the docs are
 * clean, and a gate that reports success for the condition it exists to detect
 * is worse than no gate. Zero HITS is the intended steady state and is printed
 * as such, so a green run is legible rather than merely silent.
 */
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { scanText, PORTAL_PREFIXES } from './lib/no-portal-routes.mjs';

const root = process.cwd();

// execFileSync with no shell: `execSync("… || true")` is not portable to the
// Windows shell, and git exits non-zero when a pathspec matches nothing. Same
// mechanism as check-doc-links.mjs, deliberately — one enumeration story for
// the markdown gates.
function trackedMarkdown() {
    const out = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' });
    return out
        .split('\n')
        .filter(Boolean)
        // Working notes that reference plans and specs, archived and deleted by
        // design. Same exclusion the link gate makes, for the same reason.
        .filter((f) => !f.startsWith('[redacted]'));
}

const files = trackedMarkdown();
const hits = [];

for (const file of files) {
    for (const hit of scanText(readFileSync(join(root, file), 'utf8'))) {
        hits.push({ ...hit, file });
    }
}

console.log(
    `[no-portal-routes] ${files.length} markdown file(s) scanned against ` +
        `${PORTAL_PREFIXES.length} hosted-only prefix(es), ${hits.length} hit(s)`,
);

if (files.length === 0) {
    console.error('[no-portal-routes] FAIL — scanned nothing. The pathspec is broken, not the docs.');
    process.exit(1);
}

if (hits.length > 0) {
    console.error('\nBare hosted-service paths (each names the file, the line and the path):\n');
    // Name them, do not merely count them. A count says the gate is red and
    // nothing about where to go.
    for (const { file, line, path } of hits) {
        console.error(`  ${file}:${line}  ->  ${path}`);
    }
    console.error(
        '\nEither link to it absolutely (https://inspectorhub.io/…), or — if the sentence\n' +
            'genuinely needs the bare path, which is usually because it says we do NOT\n' +
            'document it — add `<!-- no-portal-routes-allow: <reason> -->` on that line.\n',
    );
    process.exit(1);
}

console.log('  ✓ no hosted-service route is written as a path in this repository.');
