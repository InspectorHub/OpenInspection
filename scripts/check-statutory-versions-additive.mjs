#!/usr/bin/env node
/**
 * A published statutory revision may be WITHDRAWN. It may never DISAPPEAR.
 *
 * ── What the difference costs ───────────────────────────────────────────────
 * Every report already produced from a revision resolves that revision again
 * when it is re-issued: the inspection carries a snapshot, the snapshot names
 * the form, and the catalogue answers which revision applied on the inspection
 * date. Delete the revision and that answer becomes `null` — the report can no
 * longer be produced at all, and the document it would reproduce is an official
 * form already in somebody else's hands.
 *
 * So the two operations are not two spellings of one thing:
 *
 *   withdrawing — `withdrawn` is set, carrying the date AND the reason (this
 *                 software's field map was found wrong, or the authority
 *                 withdrew the revision — they ask a workspace to do opposite
 *                 things). New production stops; the revision is still in the
 *                 list, so re-issuing still resolves. ALLOWED, and this gate
 *                 stays green on it.
 *   removing    — the `(formId, version)` pair is gone from the catalogue.
 *                 REFUSED here.
 *
 * ⚠️ The wording matters because the obvious short version — "versions are
 * append-only" — reads as "you can never take a revision out of service", and
 * taking a revision out of service is a capability this subsystem is required to
 * have (a field map found to be wrong; an authority withdrawing a revision).
 *
 * ── Why a baseline file and not a git diff ──────────────────────────────────
 * The claim is about the whole history, not about the previous commit: a
 * revision removed three commits ago and a revision removed in this one are the
 * same breakage. A committed baseline states what has EVER been published, so
 * the answer does not depend on how far back anybody looked.
 *
 * ── Why the matcher is exercised on every run ───────────────────────────────
 * This repository publishes no statutory form today, so the real scan reads zero
 * modules on every deployment — and zero is exactly what a broken matcher, a
 * moved directory and a failed read all produce. The fixtures below therefore
 * run on the ORDINARY run, not behind a flag: a gate registered with a
 * self-test flag passes forever while reading nothing, which is this
 * repository's oldest failure shape.
 *
 *   node scripts/check-statutory-versions-additive.mjs
 *   node scripts/check-statutory-versions-additive.mjs --update   # re-baseline
 */
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORMS_DIR = join(ROOT, 'server/lib/statutory/forms');
const CATALOGUE = join(FORMS_DIR, 'index.ts');
const BASELINE = join(ROOT, 'scripts/statutory-version-baseline.json');

/**
 * Comments first, always.
 *
 * Every file in this subsystem EXPLAINS the revisions it carries in prose, and
 * a form module's header routinely names the revision it replaced. Matching raw
 * source would read those sentences as published revisions — the trap this
 * repository has hit repeatedly with content-matching gates, and it bites
 * hardest on the sentence that says what a file deliberately does NOT contain.
 */
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

/**
 * The one `(formId, version)` a form module publishes, or why it could not be
 * read. Never guesses: a module it cannot read is a failure, not a skip.
 *
 * A module names its pair twice — once on the revision and once on the field map
 * authored against it — and the fidelity gate already refuses a module whose two
 * halves disagree. So one distinct value of each is the expected shape, and
 * anything else is reported rather than silently collapsed.
 *
 * `(?<![A-Za-z])` on `version` so `schemaVersion:` and `sourceVersion:` are not
 * read as revision labels.
 */
export function revisionIn(source) {
    if (typeof source !== 'string') return { kind: 'unreadable' };
    const code = stripComments(source);
    const formIds = [...new Set([...code.matchAll(/\bformId:\s*'([^']+)'/g)].map((m) => m[1]))];
    const versions = [...new Set([...code.matchAll(/(?<![A-Za-z])version:\s*'([^']+)'/g)].map((m) => m[1]))];
    if (formIds.length === 0 && versions.length === 0) return { kind: 'none' };
    if (formIds.length !== 1 || versions.length !== 1) {
        return { kind: 'ambiguous', formIds, versions };
    }
    return { kind: 'ok', key: `${formIds[0]}@${versions[0]}` };
}

// ---------------------------------------------------------------------------
// The matcher's positive control, run on every ordinary run
// ---------------------------------------------------------------------------

const FIXTURES = [
    [
        "export const version = { formId: 'tx_trec_rei', version: '7-6' };\n"
        + "export const fieldMap = { formId: 'tx_trec_rei', version: '7-6' };",
        'ok', 'tx_trec_rei@7-6',
    ],
    [
        // The prose case. This header names the revision this module REPLACED,
        // which a raw grep would publish as a second revision.
        "// Supersedes version: '7-5', whose map may not be inherited.\n"
        + "export const version = { formId: 'tx_trec_rei', version: '7-6' };",
        'ok', 'tx_trec_rei@7-6',
    ],
    [
        // `schemaVersion` is not a revision label.
        "export const version = { formId: 'fl_oir', version: 'Rev. 04/26', schemaVersion: '2' };",
        'ok', 'fl_oir@Rev. 04/26',
    ],
    ["export const version = { formId: 'a', version: '1' };\nconst other = { formId: 'b', version: '2' };", 'ambiguous', null],
    ['export const nothing = 1;', 'none', null],
    [null, 'unreadable', null],
];

let selfTestFailures = 0;
for (const [source, wantKind, wantKey] of FIXTURES) {
    const got = revisionIn(source);
    if (got.kind !== wantKind || (wantKey !== null && got.key !== wantKey)) {
        selfTestFailures += 1;
        console.log(`  ✘ matcher self-check: ${JSON.stringify(String(source).slice(0, 48))} -> `
            + `${got.kind}/${got.key ?? '-'}, expected ${wantKind}/${wantKey ?? '-'}`);
    }
}

// ---------------------------------------------------------------------------
// The real scan
// ---------------------------------------------------------------------------

const failures = [];

if (!existsSync(CATALOGUE)) {
    console.log('statutory-additive: no catalogue at server/lib/statutory/forms/index.ts.');
    console.log('  The reader is looking in the wrong place, or the subsystem moved. A missing');
    console.log('  catalogue is a failure, never a pass.');
    process.exit(1);
}
const catalogue = readFileSync(CATALOGUE, 'utf8');

/** One module per published revision; `index.ts` is the catalogue, not a form. */
const modules = readdirSync(FORMS_DIR)
    .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
    .map((file) => ({ file, source: readFileSync(join(FORMS_DIR, file), 'utf8') }));

const current = new Set();
for (const mod of modules) {
    const verdict = revisionIn(mod.source);
    if (verdict.kind === 'ok') {
        current.add(verdict.key);
        continue;
    }
    if (verdict.kind === 'ambiguous') {
        failures.push(`  ✘ ${mod.file} names ${verdict.formIds.length} form id(s) and `
            + `${verdict.versions.length} revision label(s) in code, so which revision it publishes `
            + 'cannot be read. One module publishes one revision; unreadable is a failure here, '
            + 'never a pass.');
        continue;
    }
    failures.push(`  ✘ ${mod.file} names no formId and no version in code, so this gate cannot `
        + 'tell what it publishes. A module the gate cannot read is one whose removal it could '
        + 'not detect either.');
}

/**
 * Is emptiness DECLARED? Same mechanism as the fidelity gate, and for the same
 * reason: an empty catalogue and a catalogue that failed to load are the same
 * zero from out here, so one of them has to be written down.
 */
const declaredEmpty = /EMPTY_CATALOGUE_REASON\s*:\s*string\s*\|\s*null\s*=\s*\n?\s*'([\s\S]{40,}?)';/
    .test(catalogue);

if (current.size === 0 && !declaredEmpty) {
    failures.push('  ✘ the catalogue reads as EMPTY and declares no reason. Zero is what a broken '
        + 'matcher, a moved directory and a failed load all look like, so an undeclared zero is a '
        + 'failure — set EMPTY_CATALOGUE_REASON in server/lib/statutory/forms/index.ts, or publish '
        + 'a form.');
}

// ---------------------------------------------------------------------------
// --update: re-baseline. Additive by construction — it never drops a key.
// ---------------------------------------------------------------------------

if (process.argv.includes('--update')) {
    if (selfTestFailures > 0 || failures.length > 0) {
        console.log('statutory-additive: refusing to write a baseline from a scan that did not '
            + 'read cleanly. Baselining a broken read makes the breakage permanent.');
        for (const f of failures) console.log(f);
        process.exit(1);
    }
    const previous = existsSync(BASELINE)
        ? new Set(JSON.parse(readFileSync(BASELINE, 'utf8')))
        : new Set();
    // Union, never replacement. A `--update` that could DROP a key would be the
    // one-command way around this gate, which is the same as not having it.
    const merged = [...new Set([...previous, ...current])].sort();
    writeFileSync(BASELINE, `${JSON.stringify(merged, null, 2)}\n`);
    console.log(`statutory-additive: baseline written — ${previous.size} kept · `
        + `${merged.length - previous.size} added · ${merged.length} total.`);
    process.exit(0);
}

// Fail closed: an unreadable baseline is an error, never "nothing to compare".
if (!existsSync(BASELINE)) {
    console.log('statutory-additive: the baseline file is missing, so this gate compared nothing.');
    console.log('  Unreadable is a failure here: it looks exactly like "no revisions were removed".');
    console.log('  Create it with: node scripts/check-statutory-versions-additive.mjs --update');
    process.exit(1);
}

let baseline;
try {
    const parsed = JSON.parse(readFileSync(BASELINE, 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('not an array');
    baseline = new Set(parsed);
} catch (err) {
    console.log(`statutory-additive: the baseline file could not be read as a list (${err.message}).`);
    console.log('  Unreadable is a failure here, never a pass.');
    process.exit(1);
}

const gone = [...baseline].filter((k) => !current.has(k));

// Printed on EVERY run including the zeroes. A 0 a tick swallows is how a gate
// comes to look healthy while comparing nothing.
console.log(`statutory-additive: matcher self-check ${FIXTURES.length} case(s) / `
    + `${FIXTURES.length - selfTestFailures} as expected.`);
console.log(`statutory-additive: ${baseline.size} baselined revision(s) / ${current.size} present `
    + `in ${modules.length} form module(s) · ${gone.length} disappeared.`);

for (const k of gone) {
    failures.push(`  ✘ ${k} is in the baseline and is no longer in the catalogue. A revision that `
        + 'disappears cannot re-issue the reports already produced from it, and those are official '
        + 'documents in other people\'s hands. To stop NEW production, set `withdrawn` to a '
        + '`{ at, reason }` — withdrawing is allowed, leaves the revision resolvable, and keeps '
        + 'this gate green. Removing it is not.');
}

if (selfTestFailures > 0) {
    console.log('  ✘ the matcher misread its own fixtures, so a clean scan over the catalogue '
        + 'would mean nothing.');
}

if (failures.length > 0 || selfTestFailures > 0) {
    for (const f of failures) console.log(f);
    process.exit(1);
}
process.exit(0);
