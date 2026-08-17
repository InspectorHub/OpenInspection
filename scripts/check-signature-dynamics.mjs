#!/usr/bin/env node
/**
 * lint:signature-dynamics — a signature may be a picture. It may never become a
 * biometric template.
 *
 * The invariant, in review words:
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
 * ── The other half of this invariant (CA-17, review) ──────────────────────
 * The first half above is about the INPUT: how the mark was made. This half is
 * about the USE: a signature image is never used or stored for biometric
 * AUTHENTICATION. review asked for it in THIS gate rather than beside it,
 * because §1798.81.5(d)(1)(A)(vi) turns on "used to authenticate" — and split
 * across two gates someone could satisfy one while breaking the other. A pad
 * that captures nothing but a picture still crosses the line the moment that
 * picture is matched against a stored one to decide who somebody is.
 *
 * Three shapes, which are the three stages of every biometric pipeline:
 *
 *   6. FEATURE EXTRACTION from a signature image — the step that turns a
 *      picture into a key.
 *   7. A STORED signature-image TEMPLATE — the artefact the statute names.
 *   8. COMPARISON of two signature images — the authentication decision itself.
 *
 * What is NOT banned, and why the patterns carry `Image` explicitly:
 *
 *   - `signatureImageHash` is real (`server/api/inspections/agreements.ts`) and
 *     is the approved mechanism: a SHA-256 fingerprint of the stored image,
 *     which proves the record is unaltered and identifies nobody. A hash is not
 *     a feature vector, and this gate must never push anyone off it.
 *   - An email-signature TEMPLATE is an ordinary, unrelated product feature, so
 *     the template rule requires `Image` rather than banning the word.
 *   - `verifyTelnyxSignature`, `validateTwilioSignature`, `verifyInboundSignature`
 *     are cryptographic and are `lint:sigcompare`'s business — see below. Every
 *     rule here needs `Image` or an unambiguous biometric noun, so none of them
 *     can be reached from the word `Signature` alone.
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
 * Eight shapes, one boundary. 1-5 are the INPUT (how the mark was made); 6-8
 * are the USE (what the picture is then made to decide).
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
 *  6. Feature extraction from a signature image (`extractSignatureImageFeatures`,
 *     `signatureImageFeatures`, `signature_image_descriptor`).
 *  7. A stored signature-image template (`signatureImageTemplate`,
 *     `enrollSignatureImage`, `signature_image_template`).
 *  8. Comparison of two signature images (`compareSignatureImages`,
 *     `signatureImageSimilarity`, `signature_image_match`).
 *
 * `ctx.stroke()` and `ctx.strokeStyle` are the Canvas API, not our data, and
 * `strokeWidth(pen, pressure)` is the pad's own rendering — the word alone is
 * not the offence, so the patterns require the data shape. Rules 6-8 are the
 * same discipline applied to the second half: `Signature` alone is not the
 * offence either, so each of them requires `Image` or a biometric noun.
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
    // ── CA-17: the AUTHENTICATION half ──
    // 6 — feature extraction from a signature image
    // NOTE ON THE LEADING BOUNDARY: rules 6-8 carry NO `\b` in front. A mutation
    // proof planted `loadSignatureImageTemplate(...)` and the gate stayed
    // silent, because `\b` cannot match between `load` and `Signature` — any
    // verb prefix walked straight through. The trailing `\b` is kept: the END of
    // the identifier is what carries the meaning. No prefix is exempted, not
    // even `email`: an email-signature template that happens to hold an image
    // would trip this and should be renamed or argued about in the open, which
    // is a far cheaper failure than a biometric template hidden behind a prefix
    // somebody added to an exemption list.
    '(?:extract|derive|compute|encode)[A-Za-z]*[Ss]ignature[A-Za-z]*(?:Features?|Descriptors?|Embeddings?|Vectors?)\\b',
    '[Ss]ignature(?:Image)?(?:Features?|Descriptors?|Embeddings?|FeatureVectors?)\\b',
    // 7 — a stored signature-image template, and enrolment into one
    '[Ss]ignature[A-Za-z]*Image[A-Za-z]*Template\\b',
    '[Ss]ignature[A-Za-z]*BiometricTemplate\\b',
    '(?:enrol|enroll|register)[A-Za-z]*[Ss]ignatureImages?\\b',
    // 8 — comparison of two signature images
    '(?:compare|match|score)[A-Za-z]*[Ss]ignatureImages?\\b',
    '[Ss]ignatureImages?(?:Match|Matches|Similarity|Distance|Score)\\b',
    // 6-8, snake_case: the inspector signature rides in `inspection_results.data`
    // as JSON, so the column-shaped spelling has to be here too.
    '\\bsignature_image_(?:features?|descriptors?|embeddings?|vectors?|template|match|similarity|distance|score)\\b',
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

/**
 * The must-flag cases for rules 6-8 are the real lines of this codebase with
 * the violation inserted, not invented snippets: the enclosing statement, the
 * column name and the field name are all things that exist today
 * (`server/lib/inspection/auto-sign.ts`, `server/lib/db/schema/inspection/agreements.ts`,
 * `server/api/inspections/agreements.ts`). That is deliberate — a positive
 * control assembled out of nothing only proves the pattern matches itself,
 * whereas these prove it matches the shape the violation would actually take
 * when someone adds it to the code that is already there.
 *
 * The must-NOT-flag cases for rules 6-8 are real lines, copied verbatim. Three
 * of them are cryptographic verification, which `lint:sigcompare` REQUIRES —
 * without them here the two gates eventually collide on one line of code.
 */
function selfTest() {
    const mustFlag = [
        "import type { Stroke } from '../components/media-studio/signaturePad.logic';",
        'const pts: StrokePoint[] = body.strokes;',
        'strokePoints: z.array(z.object({ x: z.number(), y: z.number(), p: z.number() })),',
        "signatureStrokes: text('signature_strokes'),",
        'pressure: z.number(),',
        // 6 — feature extraction
        'const features = extractSignatureImageFeatures(inspector.defaultSignatureBase64);',
        "signatureImageFeatures: text('signature_image_features'),",
        // 7 — a stored template
        "signatureImageTemplate: text('signature_image_template'),",
        'await enrollSignatureImage(inspector.id, inspector.defaultSignatureBase64);',
        // 8 — comparison of two images
        'if (compareSignatureImages(stored.signatureBase64, presented.signatureBase64) > 0.92) {',
        'const signatureImageSimilarity = score(stored, presented);',
        "data._inspector_signature = { signature_image_match: true };",
        // The verb-prefixed forms. These are here because the first mutation
        // proof planted exactly this line and the gate said nothing.
        'const stored = await loadSignatureImageTemplate(inspector.id);',
        'const s = getSignatureImageSimilarity(a, b);',
        'const v = buildSignatureFeatureVector(signatureBase64);',
    ];
    const mustNotFlag = [
        'const signatureBase64 = pad.toDataURL();',
        'signatureBase64: z.string().min(50).max(500_000),',
        'const stroke = ctx.strokeStyle;',
        'await ctx.stroke();',
        'strokeWidth(pen, pressure)',
        // Real lines. The first is the APPROVED mechanism CA-17 leaves intact:
        // a fingerprint of the image, which proves nothing about a person.
        'signatureImageHash: sigHash ? `sha256:${sigHash}` : null,',
        "return await crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(rawBody));",
        'return constantTimeEquals(expected, presented);',
        'export async function verifyInboundSignature(',
        'if (!inspector?.defaultSignatureBase64) return;',
        "signatureBase64:    text('signature_base64'),",
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
    console.error('\n✘ A signature crossed the line between a picture and a biometric:\n');
    for (const h of hits) console.error(`    ${h.file}:${h.line}\n      ${h.text}`);
    console.error('\n  A rendered signature IMAGE is evidence and may be persisted. Two things');
    console.error('  it may never become:\n');
    console.error('  1. A BEHAVIOURAL TEMPLATE. Stroke geometry, pen pressure and timing may');
    console.error('     not leave app/components/media-studio/ — not in a schema, not in a');
    console.error('     column, and not inside inspection_results.data, which is JSON and');
    console.error('     would carry one with no schema change at all.');
    console.error('  2. AN AUTHENTICATOR (CA-17). Extracting features from the image, storing');
    console.error('     a template of it, or comparing two of them to decide who someone is');
    console.error('     makes it biometric data under a statute that turns on the words "used');
    console.error('     to authenticate". Hashing the image is the approved alternative and is');
    console.error('     untouched: a fingerprint proves the record is unaltered and identifies');
    console.error('     nobody.\n');
    process.exit(1);
}

console.log('✓ No behavioural signature data outside the signature pad.\n');
