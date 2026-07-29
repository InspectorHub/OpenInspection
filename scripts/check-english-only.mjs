#!/usr/bin/env node
/**
 * English-only gate for source (CLAUDE.md "Language Rules").
 *
 * OpenInspection is public. Its source, comments and user-facing strings are
 * read by people who do not read Chinese, and a CJK comment is a dead end for
 * every one of them. The rule was already written down; nothing enforced it, so
 * 11 files had drifted — mostly project shorthand that made perfect sense to
 * whoever typed it and none at all to a contributor.
 *
 * Scope note: this checks SOURCE. Translations under messages/<locale>/ are the
 * point of having translations, and the private superproject's docs are not
 * covered by this rule at all.
 *
 * Runs in `npm run lint` (CI's verify job) and deliberately NOT in pre-commit:
 * it walks the whole tree, and drifting language is not the kind of mistake
 * that needs catching within seconds of typing it. CI is soon enough.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

/**
 * Detection is by numeric code point rather than a character class, so this
 * file contains no CJK of its own and passes its own gate. (A regex literal
 * would have to spell the range out, which is exactly the thing being banned —
 * the first draft failed itself on that line, which is a decent sign the gate
 * works.)
 *
 * Ranges: CJK unified ideographs, extension A, CJK symbols and punctuation,
 * and halfwidth/fullwidth forms.
 */
const CJK_RANGES = [
    [0x4e00, 0x9fff],
    [0x3400, 0x4dbf],
    [0x3000, 0x303f],
    [0xff00, 0xffef],
];

function firstCjkIndex(text) {
    for (let i = 0; i < text.length; i++) {
        const c = text.charCodeAt(i);
        for (const [lo, hi] of CJK_RANGES) {
            if (c >= lo && c <= hi) return i;
        }
    }
    return -1;
}

const EXTS = ['.ts', '.tsx', '.js', '.mjs', '.css', '.html'];

const SKIP_DIRS = new Set([
    'node_modules', '.git', 'build', 'dist', '.wrangler', '.worktrees',
    '.react-router', 'paraglide', 'messages', 'public', 'local-fixtures', 'coverage',
]);

/**
 * Files where CJK is the POINT, not an accident. Each needs a reason — an
 * allowlist without one becomes a place to hide things.
 */
const ALLOWED = new Map([
    ['scripts/check-migration-refs.mjs',
     'Contains the pattern that BANS Chinese migration references; removing the Chinese would disable that gate.'],
    ['tests/unit/platform/content-disposition.spec.ts',
     'Asserts RFC 5987 encoding of a non-ASCII filename — the CJK string is the test input.'],
]);

const offenders = [];

function walk(dir) {
    for (const name of readdirSync(dir)) {
        const abs = join(dir, name);
        if (statSync(abs).isDirectory()) {
            if (!SKIP_DIRS.has(name)) walk(abs);
            continue;
        }
        if (!EXTS.some((e) => name.endsWith(e))) continue;

        const rel = relative(ROOT, abs).split(sep).join('/');
        if (ALLOWED.has(rel)) continue;

        let text;
        try { text = readFileSync(abs, 'utf8'); } catch { continue; }
        if (firstCjkIndex(text) === -1) continue;

        text.split('\n').forEach((line, i) => {
            if (firstCjkIndex(line) !== -1) {
                offenders.push({ rel, line: i + 1, text: line.trim().slice(0, 100) });
            }
        });
    }
}

walk(ROOT);

if (offenders.length > 0) {
    console.error(`❌ English-only gate — ${offenders.length} line(s) with CJK characters in source:\n`);
    for (const o of offenders) console.error(`  ✘ ${o.rel}:${o.line}  ${o.text}`);
    console.error(`
  OpenInspection is a public repository: source, comments and user-facing
  strings must be English (CLAUDE.md "Language Rules"). Translate the comment.
  If the characters ARE the subject of the code — test data, or a pattern that
  matches them — add the file to ALLOWED in scripts/check-english-only.mjs
  with the reason.`);
    process.exit(1);
}

console.log(`✅ English-only gate — no CJK in source (${ALLOWED.size} file(s) allowlisted with reasons).`);
