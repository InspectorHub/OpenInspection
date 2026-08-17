#!/usr/bin/env node
/**
 * lint:signature-dynamics — a signature may be a picture. It may never become a
 * biometric template.
 *
 * The invariant, in counsel's words:
 *
 *   OpenInspection may persist a rendered signature image for execution and
 *   evidence purposes, but must not persist or derive a reusable biometric or
 *   behavioural signature template.
 *
 * ── Why a gate and not a note ───────────────────────────────────────────────
 * The pad ALREADY samples pointer pressure and coalesced events into
 * `StrokePoint { x, y, p }` in memory. Its handle exposes only `toDataURL`,
 * `isEmpty` and `clear`, so today the boundary holds by the ABSENCE OF ONE
 * ACCESSOR. That is one refactor from being untrue, and the cheapest possible
 * control is to write the prohibition down while it still costs nothing.
 *
 * ── The boundary a column grep cannot see ───────────────────────────────────
 * The inspector signature is written into `inspection_results.data` as
 * `_inspector_signature` — a JSON blob. A stroke payload could ride there with
 * NO schema change at all, so this gate scans for the stroke SYMBOLS and for
 * stroke-shaped request fields, never for column definitions.
 *
 * ── The exemption is a DIRECTORY ────────────────────────────────────────────
 * `app/components/media-studio/` is where this data is legitimately handled: it
 * is drawn there, and it never leaves. An allowlist of file names would grow one
 * entry at a time until it described nothing; a directory boundary is the thing
 * actually being defended.
 *
 * ── Not `sigcompare` ────────────────────────────────────────────────────────
 * `scripts/check-signature-compare.mjs` (`lint:sigcompare`) already exists and
 * requires the OPPOSITE: it forces cryptographic verification through
 * `crypto.subtle.verify` or a constant-time compare. Same word, inverted duty.
 * The names must stay distinct or the two will be read as one rule.
 *
 * ── The other half of this invariant ────────────────────────────────────────
 * Round 27 (CA-17) adds "the signature image is never used or stored for
 * biometric AUTHENTICATION", and counsel asked for it in THIS gate rather than
 * beside it: §1798.81.5(d)(1)(A)(vi) turns on "used to authenticate", and split
 * across two gates someone could satisfy one while breaking the other. That
 * half — feature extraction from a signature image, a stored image template,
 * comparison of two signature images — extends this file. It is not built yet.
 *
 * Usage: node scripts/check-signature-dynamics.mjs [--self-test]
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['server', 'workers', 'packages', 'app'];
/** Where a stroke legitimately exists: it is drawn here and never leaves. */
const ALLOWED_DIR = join('app', 'components', 'media-studio');
const EXT = /\.(ts|tsx)$/;
const SKIP = /(\.test\.|\.spec\.|[\\/]tests?[\\/])/;

/**
 * Five shapes, one boundary.
 *
 *  1. The stroke SYMBOLS themselves (`Stroke`, `StrokePoint`, the pad module) —
 *     the type-level tell that stroke data crossed the line.
 *  2. A stroke-shaped FIELD name (`strokes`, `strokePoints`, `signature_strokes`)
 *     in a schema, a column, or a request body.
 *  3. A bare `pressure` field. Pen pressure is the behavioural signal; a field
 *     called that in a schema is the template forming.
 *  4. `velocity` / `acceleration` on a signature — the other two behavioural
 *     axes a template is built from.
 *  5. Timing arrays keyed to a signature (`strokeTimings`, `pointTimestamps`).
 *
 * `ctx.stroke()` and `ctx.strokeStyle` are the Canvas API, not our data, and
 * `strokeWidth(pen, pressure)` is the pad's own rendering — the word alone is
 * not the offence, so the patterns require the data shape.
 */
const BANNED = new RegExp([
    // 1 — the symbols and the module
    '\\bStrokePoint\\b',
    '\\bsignaturePad\\.logic\\b',
    "\\bStroke\\b(?=[^\\w]*(?:\\[|\\}|,|;|\\)|from))",
    // 2 — stroke-shaped fields
    '\\b(?:signature_?)?[Ss]trokes?\\s*:\\s*(?:z\\.|text\\(|\\[|Array|Stroke)',
    "\\bsignature_strokes\\b",
    '\\bstrokePoints?\\b',
    // 3 — pen pressure as a stored/validated field
    '\\bpressure\\s*:\\s*(?:z\\.|number|integer\\(|text\\()',
    // 4 — the other behavioural axes
    '\\b(?:signature)?(?:[Vv]elocity|[Aa]cceleration)\\s*:\\s*(?:z\\.|number|integer\\(|real\\()',
    // 5 — timing arrays
    '\\b(?:strokeTimings?|pointTimestamps?)\\b',
].join('|'));

function walk(dir, out = []) {
    let entries;
    try { entries = readdirSync(dir); } catch { return out; }
    for (const e of entries) {
        const p = join(dir, e);
        if (e === 'node_modules' || e === '.git') continue;
        if (statSync(p).isDirectory()) walk(p, out);
        else if (EXT.test(e) && !SKIP.test(p)) out.push(p);
    }
    return out;
}

function selfTest() {
    const mustFlag = [
        "import type { Stroke } from '../components/media-studio/signaturePad.logic';",
        'const pts: StrokePoint[] = body.strokes;',
        'strokePoints: z.array(z.object({ x: z.number(), y: z.number(), p: z.number() })),',
        "signatureStrokes: text('signature_strokes'),",
        'pressure: z.number(),',
    ];
    const mustNotFlag = [
        'const signatureBase64 = pad.toDataURL();',
        'signatureBase64: z.string().min(50).max(500_000),',
        'const stroke = ctx.strokeStyle;',
        'await ctx.stroke();',
        'strokeWidth(pen, pressure)',
    ];
    let bad = 0;
    for (const s of mustFlag) if (!BANNED.test(s)) { console.error(`  MISSED: ${s}`); bad++; }
    for (const s of mustNotFlag) if (BANNED.test(s)) { console.error(`  FALSE POSITIVE: ${s}`); bad++; }
    console.log(`  self-test: ${mustFlag.length} must-flag, ${mustNotFlag.length} must-not-flag, ${bad} wrong`);
    return bad === 0;
}

const args = process.argv.slice(2);
if (args.includes('--self-test')) process.exit(selfTest() ? 0 : 1);
if (!selfTest()) {
    console.error('\n✘ signature-dynamics gate: its own self-test failed. Fix the gate before trusting it.');
    process.exit(1);
}

const files = DIRS
    .flatMap((d) => walk(join(ROOT, d)))
    .map((f) => relative(ROOT, f))
    .filter((f) => !f.startsWith(ALLOWED_DIR));

const hits = [];
for (const f of files) {
    const lines = readFileSync(join(ROOT, f), 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
        if (BANNED.test(line)) hits.push({ file: f.split(sep).join('/'), line: i + 1, text: line.trim() });
    });
}

// Both numbers, side by side. A gate that prints only "0 problems" cannot be
// told apart from one that scanned nothing — and this one EXPECTS zero hits
// forever, which is exactly the condition where a silent scanner rots unnoticed.
console.log(`\nsignature-dynamics: ${files.length} file(s) scanned outside ${ALLOWED_DIR.split(sep).join('/')}, ${hits.length} hit(s).`);

if (files.length === 0) {
    console.error('✘ Scanned zero files — the gate is looking in the wrong place, not passing.');
    process.exit(1);
}

if (hits.length > 0) {
    console.error('\n✘ Behavioural signature data outside the signature pad:\n');
    for (const h of hits) console.error(`    ${h.file}:${h.line}\n      ${h.text}`);
    console.error('\n  A rendered signature IMAGE is evidence and may be persisted. Stroke');
    console.error('  geometry, pen pressure and timing are a reusable biometric template and');
    console.error('  may not leave app/components/media-studio/ — not in a schema, not in a');
    console.error('  column, and not inside inspection_results.data, which is JSON and would');
    console.error('  carry one with no schema change at all.\n');
    process.exit(1);
}

console.log('✓ No behavioural signature data outside the signature pad.\n');
