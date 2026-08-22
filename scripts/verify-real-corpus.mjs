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

const unrecorded = observations.filter((o) => !o.fileSha256);
const recorded = observations.filter((o) => o.fileSha256);

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

// Both numbers, side by side, and every skip named. A gate that reports only
// its verdict is unauditable on the day it is green for the wrong reason.
console.log(`  ${files.length} file(s) in the corpus · ${observations.length} observation(s) declared`);
console.log(`  ${confirmed.length} confirmed · ${missing.length} unmatched · `
  + `${unrecorded.length} carrying no hash yet`);

if (files.length === 0) {
  console.log('✘ The corpus directory is empty. A run over nothing is not a verification.');
  process.exit(1);
}

for (const observation of unrecorded) {
  console.log(`  ⚠️ NOT VERIFIED: ${observation.vendor}/${observation.quirk} — `
    + 'fileSha256 is null. Record the hash of the file it was seen in.');
}
for (const problem of missing) console.log(`  ✘ ${problem}`);

if (unrecorded.length || missing.length) {
  console.log('\n✘ Real-corpus gate — every declared quirk must name a hash this corpus holds.');
  console.log('  An unrecorded hash is a GAP, not a pass: it means nothing here can tell');
  console.log('  a quirk somebody measured from a quirk somebody assumed.');
  process.exit(1);
}

console.log('✅ Real-corpus gate — every declared quirk was confirmed against a file held here.');
process.exit(0);
