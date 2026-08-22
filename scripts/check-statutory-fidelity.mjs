#!/usr/bin/env node
/**
 * Every statutory form this software publishes has a field map, authored
 * against that revision's own bytes, with a person's name on it.
 *
 * ── What this answers, and what it emphatically does not ────────────────────
 * It answers three questions a reader can check from a clone: does each
 * published revision have a map, was that map authored against the sha256 this
 * revision publishes, and did somebody sign for it. The value-level checks —
 * that the named form fields exist, that no coordinate falls off the page, that
 * every required field is mapped — need the published PDF, which is not in this
 * repository; they live in `validateFieldMap` / `validateAgainstPdf` and run in
 * `tests/unit/statutory-forms/`.
 *
 * ⚠️ AND IT CANNOT PROVE ANYBODY READ THE FORM. `checkedBy` and `checkedAt` are
 * typed by whoever authored the map. This gate can show that a map exists, that
 * it names the right revision, and that a name is attached; it has no way to
 * establish that a person opened the agency's PDF and compared it box by box.
 * That limit cannot be closed in code, so it is printed on every run rather than
 * left to be inferred from a green tick.
 *
 * ── Why an empty catalogue is not automatically a pass ──────────────────────
 * This repository ships no statutory form today, and "zero" is exactly the
 * reading that a broken matcher, a moved directory or a failed load all produce.
 * So emptiness has to be DECLARED, in `EMPTY_CATALOGUE_REASON`
 * (`server/lib/statutory/forms/index.ts`): an empty catalogue with a declaration
 * passes and prints it; an empty catalogue without one FAILS. The reverse is a
 * failure too — a declaration of emptiness left behind after a form is
 * published explains a state that no longer holds.
 *
 *   node scripts/check-statutory-fidelity.mjs
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const FORMS_DIR = join(root, 'server/lib/statutory/forms');
const CATALOGUE = join(FORMS_DIR, 'index.ts');
const SPEC_DIR = join(root, 'tests/unit/statutory-forms');

const failures = [];
const rows = [];
const skips = [];

/** One module per published revision; `index.ts` is the catalogue, not a form. */
function formModules() {
    if (!existsSync(FORMS_DIR)) return [];
    return readdirSync(FORMS_DIR)
        .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
        .map((file) => ({ file, source: readFileSync(join(FORMS_DIR, file), 'utf8') }));
}

const specs = existsSync(SPEC_DIR)
    ? readdirSync(SPEC_DIR)
        .filter((f) => f.endsWith('.spec.ts'))
        .map((f) => ({ name: f, source: readFileSync(join(SPEC_DIR, f), 'utf8') }))
    : [];

const catalogue = existsSync(CATALOGUE) ? readFileSync(CATALOGUE, 'utf8') : null;
if (catalogue === null) {
    console.log('statutory-fidelity: no catalogue at server/lib/statutory/forms/index.ts.');
    console.log('  The reader is looking in the wrong place, or the subsystem moved. A missing');
    console.log('  catalogue is a failure, never a pass.');
    process.exit(1);
}

/**
 * Is emptiness declared? A `null` means "there are forms"; a string literal long
 * enough to be a sentence means "there are none, and here is why".
 */
const declaredEmpty = /EMPTY_CATALOGUE_REASON\s*:\s*string\s*\|\s*null\s*=\s*\n?\s*'([\s\S]{40,}?)';/.exec(catalogue);
const declaredNull = /EMPTY_CATALOGUE_REASON\s*:\s*string\s*\|\s*null\s*=\s*null\s*;/.test(catalogue);

const forms = formModules();

for (const form of forms) {
    const problems = [];
    const name = form.file.replace(/\.ts$/, '');

    if (!/export const version\b/.test(form.source)) problems.push('exports no `version`');
    if (!/export const fieldMap\b/.test(form.source)) problems.push('exports no `fieldMap`');
    if (!new RegExp(`from '\\./${name}'`).test(catalogue)) {
        problems.push('is not imported by forms/index.ts — a form nothing lists is never selectable');
    }

    // The hash appears on the revision and on the map authored against it. Two
    // different hashes in one file is a map that was carried over from another
    // revision, which is the failure the whole subsystem is built around.
    const hashes = [...form.source.matchAll(/sourceHash:\s*'([0-9a-f]{64})'/g)].map((m) => m[1]);
    if (hashes.length < 2) {
        problems.push(`declares ${hashes.length} sha256 literal(s); the revision and its map must each name one`);
    } else if (new Set(hashes).size !== 1) {
        problems.push(`names ${new Set(hashes).size} different sha256 values — a map may never be inherited`);
    }

    const checkedBy = /checkedBy:\s*'([^']*)'/.exec(form.source);
    if (checkedBy === null || checkedBy[1].trim() === '') problems.push('records no checkedBy');
    const checkedAt = /checkedAt:\s*([^,\n]+)/.exec(form.source);
    if (checkedAt === null) problems.push('records no checkedAt');

    const mappingCount = [...form.source.matchAll(/\bkind:\s*'(acroform|overlay|checkbox)'/g)].length;
    if (mappingCount === 0) problems.push('maps no fields at all');

    const testedBy = specs.filter((s) => s.source.includes(name)).map((s) => s.name);
    if (testedBy.length === 0) problems.push('has no spec that names it');

    if (problems.length === 0) {
        rows.push(`  ${name}  ✓ ${mappingCount} mapping(s), checked by ${checkedBy[1]}, `
            + `tested by ${testedBy.join(', ')}`);
    }
    for (const problem of problems) failures.push(`  ✘ ${form.file} ${problem}.`);
}

// Both numbers, side by side, on every run — pass or fail. A gate that speaks
// only when it is angry cannot be checked on the day it is quiet.
console.log(`statutory-fidelity: ${forms.length} published form revision(s) / `
    + `${rows.length} with a complete, hash-matched, human-checked map.`);
for (const row of rows) console.log(row);
for (const skip of skips) console.log(skip);

if (forms.length === 0) {
    if (declaredEmpty === null) {
        console.log('  ✘ The catalogue is EMPTY and says nothing about why.');
        console.log('    Zero is what a broken matcher, a moved directory and a failed load all');
        console.log('    look like. Declare it in EMPTY_CATALOGUE_REASON');
        console.log('    (server/lib/statutory/forms/index.ts), or publish a form.');
        process.exit(1);
    }
    console.log('  ⊘ 0 forms — DECLARED EMPTY:');
    // Rejoin the source's concatenated string literal and unescape its quotes,
    // so the declaration prints as the sentence somebody wrote.
    const reason = declaredEmpty[1].replace(/'\s*\n\s*\+\s*'/g, '').replace(/\\'/g, "'").trim();
    console.log(`    "${reason}"`);
    console.log('  ⚠️ This gate proves a map exists, names the right revision, and carries a');
    console.log('     name. It cannot prove anybody read the form.');
    process.exit(0);
}

if (!declaredNull) {
    failures.push('  ✘ forms/index.ts declares EMPTY_CATALOGUE_REASON while forms are published — '
        + 'the declaration explains a state that no longer holds. Set it to null.');
}

if (failures.length) {
    console.log(`\n✘ Statutory-fidelity gate — ${failures.length} problem(s):`);
    console.log(failures.join('\n'));
    console.log('\n  A published form with no map cannot be rendered. A map whose hash does not');
    console.log('  match the revision was authored against different bytes, and applying it moves');
    console.log('  content into boxes nobody measured — without raising anything.');
    process.exit(1);
}

console.log('✅ Statutory-fidelity gate — every published revision has a hash-matched map.');
console.log('   ⚠️ This says nothing about whether anybody read the form. `checkedBy` is typed');
console.log('      by whoever authored the map; no gate can check it.');
process.exit(0);
