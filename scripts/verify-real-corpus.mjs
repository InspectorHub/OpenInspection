#!/usr/bin/env node
/**
 * Has this reader ever been pointed at a REAL file?
 *
 * ⚠️ THIS GATE NEVER RUNS AUTOMATICALLY. It reads files that are not in this
 * repository and must never be: they are real exports belonging to real
 * businesses. It is a release-time manual rung, run by a person who holds the
 * corpus, in the same tier as the pre-push suite — not a CI job, because CI here
 * runs on a public repository and cannot hold credentials for private material.
 *
 * ── Why it exists at all ────────────────────────────────────────────────────
 * Every other check in this area is satisfiable by a reader tested only against
 * files somebody invented — and a reader tested that way agrees with its author
 * about a format neither of them has seen. That failure has happened in this
 * codebase before, in a different integration, six times over, and each time the
 * tests were green.
 *
 *   INTAKE_CORPUS=/path/to/private/corpus node scripts/verify-real-corpus.mjs
 *
 * The corpus directory is walked; each file's SHA-256 is compared against the
 * hashes `tests/fixtures/intake/manifest.json` records. Nothing is copied,
 * printed, or written anywhere — the only output is which observations were
 * confirmed and which were not.
 *
 * ── Three states, not two ───────────────────────────────────────────────────
 * This gate used to know only "names a hash" and "does not", and reported the
 * second as a gap. That collapsed two opposite situations into one red line:
 *
 *   fileSha256: null   nobody has checked yet — work owed
 *   notObserved: {…}   somebody checked and the quirk WAS NOT THERE — which is
 *                      not work owed, it is a reason to doubt the schema entry
 *
 * The second happened on 2026-08-24: a quirk recorded as seen on 65 of 1872
 * rows measured 0 of 1872 under two independent instruments, and the number 65
 * turned out to be reproducible from a defect in how the first instrument
 * tokenized the file. With only two states there was nowhere to put that except
 * a null, which would have read as "get round to it" forever.
 *
 * ⚠️ A `notObserved` claim is itself checked. It must name the hash it was
 * checked against, and that file must still be in the corpus — otherwise
 * "we looked and it wasn't there" is an assertion about a file nobody can
 * produce, which is the same species of claim this gate exists to refuse.
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const MANIFEST = join(root, 'tests/fixtures/intake/manifest.json');
const corpus = process.env.INTAKE_CORPUS;

console.log('Real-corpus verification — the PRIVATE gate.');
console.log('  Never runs in CI. Reads files that are not, and must not be, in this repository.');

if (!existsSync(MANIFEST)) {
  console.log(`✘ No manifest at ${MANIFEST}. Nothing to verify against.`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
const observations = manifest.observations ?? [];

// A zero here is a failure. An empty manifest satisfies "every observation was
// confirmed" vacuously, which is how a gate reports success on the day somebody
// deletes its input.
if (observations.length === 0) {
  console.log('✘ The manifest records 0 observations. This run proves nothing.');
  process.exit(1);
}

const negative = observations.filter((o) => o.notObserved);
const recorded = observations.filter((o) => o.fileSha256 && !o.notObserved);
const unrecorded = observations.filter((o) => !o.fileSha256 && !o.notObserved);

// An observation may not be both. "Seen in this file" and "looked for in this
// file and absent" are contradictory claims about the same quirk, and a
// manifest carrying both says nothing.
const contradictory = observations.filter((o) => o.fileSha256 && o.notObserved);
if (contradictory.length) {
  for (const o of contradictory) {
    console.log(`  ✘ ${o.vendor}/${o.quirk} carries BOTH fileSha256 and notObserved.`);
  }
  console.log('✘ An observation is confirmed or it is negative. It cannot be both.');
  process.exit(1);
}

if (!corpus) {
  console.log('  INTAKE_CORPUS is not set, so no file was read.');
  console.log(`  ${observations.length} observation(s) declared · `
    + `${recorded.length} name a hash · ${unrecorded.length} do not.`);
  console.log('✘ Cannot verify without the corpus. Set INTAKE_CORPUS to the directory holding it.');
  process.exit(1);
}

if (!existsSync(corpus)) {
  console.log(`✘ INTAKE_CORPUS points at ${corpus}, which does not exist.`);
  process.exit(1);
}

/** Every file under the corpus, however deeply nested. Names are never printed. */
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    if (statSync(abs).isDirectory()) out.push(...walk(abs));
    else out.push(abs);
  }
  return out;
}

const files = walk(corpus);
const hashes = new Set(
  files.map((f) => createHash('sha256').update(readFileSync(f)).digest('hex')),
);

const confirmed = [];
const missing = [];
for (const observation of recorded) {
  const key = `${observation.vendor}/${observation.quirk}`;
  if (hashes.has(observation.fileSha256)) confirmed.push(key);
  else missing.push(`${key} — names a hash no file in the corpus matches`);
}

// A negative claim is checked as hard as a positive one. "We looked and it was
// not there" is only worth recording if the file that was looked at can still
// be produced; otherwise it is an assertion about something nobody can inspect.
for (const observation of negative) {
  const key = `${observation.vendor}/${observation.quirk}`;
  const against = observation.notObserved.checkedAgainstSha256;
  if (!against) {
    missing.push(`${key} — notObserved names no checkedAgainstSha256, so nothing says what was looked at`);
  } else if (!hashes.has(against)) {
    missing.push(`${key} — notObserved was checked against a file this corpus no longer holds`);
  }
  if (!observation.notObserved.measured) {
    missing.push(`${key} — notObserved records no measurement, only a conclusion`);
  }
}

// Both numbers, side by side, and every skip named. A gate that reports only
// its verdict is unauditable on the day it is green for the wrong reason.
console.log(`  ${files.length} file(s) in the corpus · ${observations.length} observation(s) declared`);
console.log(`  ${confirmed.length} confirmed · ${missing.length} unmatched · `
  + `${negative.length} looked for and NOT found · ${unrecorded.length} carrying no hash yet`);

if (files.length === 0) {
  console.log('✘ The corpus directory is empty. A run over nothing is not a verification.');
  process.exit(1);
}

for (const observation of unrecorded) {
  console.log(`  ⚠️ NOT VERIFIED: ${observation.vendor}/${observation.quirk} — `
    + 'fileSha256 is null. Record the hash of the file it was seen in.');
}
// Printed on every run, green or not. A quirk the schema declares and no real
// file has ever shown is the exact thing this manifest exists to expose, and it
// would disappear if it only appeared on a failing run.
for (const observation of negative) {
  console.log(`  ⚠️ DECLARED BUT NOT SEEN: ${observation.vendor}/${observation.quirk} — `
    + `measured ${observation.notObserved.measured}.`);
  console.log('     The schema still declares it and the reader must still survive it, but');
  console.log('     nothing here has met a file that shows it. Treat that entry as unconfirmed.');
}
for (const problem of missing) console.log(`  ✘ ${problem}`);

if (unrecorded.length || missing.length) {
  console.log('\n✘ Real-corpus gate — every declared quirk must name a hash this corpus holds.');
  console.log('  An unrecorded hash is a GAP, not a pass: it means nothing here can tell');
  console.log('  a quirk somebody measured from a quirk somebody assumed.');
  process.exit(1);
}

// 🔴 Negatives alone are not a verification. Every observation being "we looked
// and it was not there" satisfies the loop above vacuously — nothing was ever
// matched against a real file, and the run reports success for having checked
// nothing. That is the same shape as the zero-observations check higher up, and
// it was reachable until 2026-08-24: a manifest of nothing but negatives went
// green.
if (confirmed.length === 0) {
  console.log('✘ Not one observation was confirmed against a file in this corpus.');
  console.log('  Negative findings do not verify a reader. A run in which nothing');
  console.log('  matched proves only that nothing was matched.');
  process.exit(1);
}

console.log(`✅ Real-corpus gate — ${confirmed.length} declared quirk(s) confirmed against a file held here`
  + (negative.length ? `, ${negative.length} looked for and not found (listed above).` : '.'));
process.exit(0);
