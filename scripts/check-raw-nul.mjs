#!/usr/bin/env node
/**
 * No tracked TEXT file may carry a raw NUL byte.
 *
 * ── What this catches, and why it is worth a gate ───────────────────────────
 * NUL is a good separator for a composite key: it is the one character that
 * cannot occur inside a form id, a URL, a semver, an email address or an OAuth
 * scope, so a key joined with it cannot be forged by a component that happens
 * to contain the delimiter. The mistake is not choosing it. The mistake is
 * writing the BYTE instead of the escape `\0`.
 *
 * One NUL anywhere in a file makes it binary to every tool that applies the
 * text/binary heuristic. `git grep`, ripgrep and a review diff all answer
 * `Binary file … matches`: a match with no line, no line number and no context.
 * The file still compiles, still passes every other check here, and still
 * behaves identically — it simply stops being readable by the tools people and
 * agents use to read it.
 *
 * ⚠️ IT BLINDS NO OTHER GATE, and that was measured before this one was
 * written: every `lint:` / `check:` / `verify:` script in this repository is
 * node, none shells out to grep, and node reads a NUL-bearing file like any
 * other. So this gate is not protecting a checker. It is protecting the diff.
 *
 * ── Why it exists at all rather than being a one-off fix ────────────────────
 * Three files carried one when this was written, in three unrelated
 * subsystems, and the oldest predated the branch that found it by a long way.
 * Nothing anywhere reported it. A fault that arrives independently three times
 * and is invisible to every existing check is exactly what a cheap gate is for.
 *
 * ── Binary files are the point of the allowlist, not an exception to it ─────
 * A `.png` is SUPPOSED to contain NULs. So the gate does not ask "is this file
 * binary" — that is the question it would be answering with the thing it is
 * trying to measure. It asks whether the file's extension is one this
 * repository stores binary content in. An unknown extension carrying a NUL
 * FAILS, and the fix is either the escape or one line here.
 *
 * Usage: node scripts/check-raw-nul.mjs [--self-test]
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const NUL = 0x00;

/**
 * Extensions whose contents are bytes rather than source. Listed explicitly,
 * because "it looked binary" is the very inference this gate replaces.
 */
const BINARY_EXTS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'ico', 'icns', 'bmp',
    'pdf', 'woff', 'woff2', 'ttf', 'otf', 'eot',
    'zip', 'gz', 'tgz', 'br', 'wasm', 'sqlite', 'db',
    'mp3', 'mp4', 'webm', 'ogg', 'wav', 'mov',
]);

const extOf = (path) => {
    const base = path.slice(path.lastIndexOf('/') + 1);
    const dot = base.lastIndexOf('.');
    return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
};

// ── Self-test. A scanner that reports absence is the failure mode here, so it
// runs against a planted NUL before it is allowed to report a clean tree.
const probeClean = Buffer.from('const key = `${a}\\0${b}`;\n', 'utf8');
const probeFaulty = Buffer.concat([
    Buffer.from('const key = `${a}', 'utf8'),
    Buffer.from([NUL]),
    Buffer.from('${b}`;\n', 'utf8'),
]);
const scan = (buf) => buf.indexOf(NUL);

if (scan(probeFaulty) === -1 || scan(probeClean) !== -1) {
    console.error('\n[raw-nul] BROKEN — the scanner failed its own self-test.');
    console.error(`   planted NUL found at: ${scan(probeFaulty)} (expected a non-negative offset)`);
    console.error(`   escaped \\0 found at:  ${scan(probeClean)} (expected -1)`);
    console.error('Until this is fixed, a clean scan means nothing.\n');
    process.exit(1);
}

if (process.argv.slice(2).includes('--self-test')) {
    console.log('\n[raw-nul] self-test OK — a planted NUL is detected and an escaped \\0 is not.\n');
    process.exit(0);
}

// ── The scan ────────────────────────────────────────────────────────────────

const tracked = execSync('git ls-files -z', { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split('\0')
    .filter((p) => p !== '');

const hits = [];
let scanned = 0;
let skippedBinary = 0;
let unreadable = 0;

for (const path of tracked) {
    if (BINARY_EXTS.has(extOf(path))) { skippedBinary += 1; continue; }
    let buf;
    try {
        buf = readFileSync(path);
    } catch {
        // A tracked path the working tree does not hold (a deletion staged
        // elsewhere). Counted, never silently folded into "clean".
        unreadable += 1;
        continue;
    }
    scanned += 1;
    const at = buf.indexOf(NUL);
    if (at !== -1) {
        hits.push({ path, line: buf.subarray(0, at).toString('utf8').split('\n').length });
    }
}

// Both numbers, always. This gate expects zero hits forever, so "nothing wrong"
// and "looked at nothing" would otherwise print the same word.
console.log(`\n[raw-nul] ${tracked.length} tracked path(s): ${scanned} scanned · `
    + `${skippedBinary} skipped as binary by extension · ${unreadable} unreadable`);

if (scanned === 0) {
    console.error('[raw-nul] scanned ZERO files. A scan of nothing is not a clean scan.\n');
    process.exit(1);
}

if (hits.length) {
    console.error(`\n${hits.length} text file(s) contain a raw NUL byte:\n`);
    for (const h of hits) console.error(`   ${h.path}:${h.line}`);
    console.error('\nA single NUL makes the whole file binary to git grep, ripgrep and every');
    console.error('review diff — they answer "Binary file ... matches", with no line number.');
    console.error('Write the escape `\\0` (or `\\u0000`) instead; it produces the same character.');
    console.error('If the file genuinely holds bytes, add its extension to BINARY_EXTS.\n');
    process.exit(1);
}

console.log('[raw-nul] OK — every tracked text file is readable as text.\n');
