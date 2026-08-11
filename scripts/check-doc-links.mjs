#!/usr/bin/env node
/**
 * Markdown link gate — every relative link and image in a tracked .md file
 * must resolve to a file that exists.
 *
 *   node scripts/check-doc-links.mjs
 *
 * Why this exists: the docs restructure found fourteen broken links, and three
 * of them had been broken for months before that change — CONTRIBUTING.md
 * pointed at `docs/extending.md`, which has never existed in this repository.
 * Nothing was looking, so nothing complained. A reader who follows a dead link
 * in the deploy guide is a reader who gives up on self-hosting.
 *
 * Scope is deliberately narrow:
 *   - relative paths only. External URLs are not fetched (a gate that needs
 *     the network is a gate that fails on a plane), and `#anchor`-only links
 *     are left alone.
 *   - `docs/superpowers/` is excluded: those are working notes that reference
 *     plans and specs which get archived and deleted by design.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { dirname, join, normalize, resolve } from 'node:path';

const root = process.cwd();

// execFileSync with no shell: `execSync("… || true")` is not portable to the
// Windows shell, and git exits non-zero when a pathspec matches nothing.
function trackedMarkdown() {
    const out = execFileSync('git', ['ls-files', '*.md'], { cwd: root, encoding: 'utf8' });
    return out.split('\n').filter(Boolean).filter((f) => !f.startsWith('docs/superpowers/'));
}

// [text](target) and ![alt](target). The target stops at the first whitespace
// so that `[x](path "title")` yields `path`.
const LINK = /(!?)\[[^\]]*\]\(\s*([^)\s]+)/g;

const SKIP = /^(https?:|mailto:|tel:|data:|#|<)/i;

const files = trackedMarkdown();
const broken = [];
let checked = 0;

for (const file of files) {
    const text = await readFile(join(root, file), 'utf8');
    const from = dirname(file);
    for (const [, , rawTarget] of text.matchAll(LINK)) {
        const target = rawTarget.trim();
        if (SKIP.test(target)) continue;
        // Strip an anchor: `guide.md#section` must resolve `guide.md`.
        const path = target.split('#')[0];
        if (!path) continue; // pure anchor, e.g. [top](#top)
        checked += 1;
        if (!existsSync(resolve(root, normalize(join(from, path))))) {
            broken.push({ file, target });
        }
    }
}

// Both numbers, always. A run that resolved zero links is a broken gate, not a
// clean repository — this repo has hundreds of them and always will.
console.log(
    `[doc-links] ${files.length} markdown files scanned, ${checked} relative links resolved, ${broken.length} broken`,
);

if (files.length === 0 || checked === 0) {
    console.error(
        '[doc-links] FAIL — scanned nothing. The pathspec or the link pattern is broken, not the docs.',
    );
    process.exit(1);
}

if (broken.length > 0) {
    console.error('\nBroken links (each names the file it is in and the target that does not exist):\n');
    // Name them, do not merely count them: a count tells you a gate is red and
    // nothing about where to go.
    for (const { file, target } of broken) {
        console.error(`  ${file}  ->  ${target}`);
    }
    console.error('\nFix the link, or create the file it promises.');
    process.exit(1);
}
