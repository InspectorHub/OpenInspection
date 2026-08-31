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

// ── Detection may notice a new revision. It may never publish one ───────────
//
// The scheduled watcher reads an authority's page and records what it saw. If
// it could also write `statutory_form_versions`, a page edited by an agency
// would become a form offered to inspectors with nobody in between — and the
// field map, which is hand-authored against one revision's bytes and may never
// be inherited, would still be the old one. So the detection path is checked
// for that table by name.
//
// ⚠️ COMMENTS ARE STRIPPED FIRST. Every file below EXPLAINS that it must not
// write that table, so a raw grep fails on the prose that documents the rule —
// the same trap this repository has hit six times with content-matching gates,
// and it bites hardest on the sentence saying "we deliberately do not use X".
const DETECTION_FILES = [
    'server/lib/statutory/revision-watch.ts',
    'server/services/statutory/revision-watch.service.ts',
    'server/cron/jobs/statutory.ts',
];
const VERSIONS_TABLE = /statutoryFormVersions|statutory_form_versions/;
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const detection = DETECTION_FILES
    .filter((f) => existsSync(join(root, f)))
    .map((f) => ({ file: f, code: stripComments(readFileSync(join(root, f), 'utf8')) }));

// A file list that resolves to nothing reads exactly like a clean pass. If the
// watcher moved, this gate is blind and must say so rather than go green.
if (detection.length !== DETECTION_FILES.length) {
    const missing = DETECTION_FILES.filter((f) => !existsSync(join(root, f)));
    failures.push(`  ✘ detect/adopt separation is UNCHECKED: ${missing.join(', ')} not found. `
        + 'A moved detection path makes this gate blind, which is a failure, not a pass.');
}

// The positive control on the matcher itself. The schema module for the
// versions table names it in code; if the pattern cannot find it there, a
// clean run over the detection files proves nothing about the detection files.
const VERSIONS_SCHEMA = join(root, 'server/lib/db/schema/statutory-forms.ts');
const controlSees = existsSync(VERSIONS_SCHEMA)
    && VERSIONS_TABLE.test(stripComments(readFileSync(VERSIONS_SCHEMA, 'utf8')));
if (!controlSees) {
    failures.push('  ✘ detect/adopt separation is UNCHECKED: the control file '
        + 'server/lib/db/schema/statutory-forms.ts does not match the pattern, so a clean '
        + 'result over the detection path would mean nothing.');
}

const adopters = detection.filter((d) => VERSIONS_TABLE.test(d.code));
for (const bad of adopters) {
    failures.push(`  ✘ ${bad.file} reaches statutory_form_versions in CODE. Detection records `
        + 'what a page served; publishing a revision is a person\'s decision and needs a field '
        + 'map authored against those exact bytes.');
}

// The other half of the same claim: the registry admits only rows that carry a
// publication decision, so a version assembled out of a sighting is refused
// rather than selected. Named here because it is the assertion that makes the
// separation structural instead of a convention.
const REGISTRY = join(root, 'server/lib/statutory/form-registry.ts');
const registryCode = existsSync(REGISTRY) ? stripComments(readFileSync(REGISTRY, 'utf8')) : '';
const admissionUses = (registryCode.match(/isPublishedVersion/g) ?? []).length;
if (admissionUses < 2) {
    failures.push(`  ✘ form-registry.ts names isPublishedVersion ${admissionUses} time(s) in code; `
        + 'it must be both defined and applied, or selection admits an unpublished revision.');
}

// ---------------------------------------------------------------------------
// UTC-midnight arm
// ---------------------------------------------------------------------------

/**
 * Every date on a published revision must land exactly on a UTC midnight.
 *
 * The reason is the cutover. `inspections.date` is a calendar day and the
 * selector takes epoch ms; `utcMidnightOf` bridges them in UTC, so a version
 * whose own dates were built in LOCAL time sits a few hours off and the
 * comparison at the boundary picks the wrong revision. That failure renders a
 * real, official, superseded document -- nothing looks broken.
 *
 * 86,400,000 divides every UTC midnight, so the check is arithmetic rather than
 * a parse. A `Date.UTC(y, m, d)` call is accepted on sight: three arguments to
 * Date.UTC IS a UTC midnight by construction.
 */
const MS_PER_UTC_DAY = 86400000;
const DATE_FIELDS = ['effectiveFrom', 'mandatoryFrom', 'effectiveUntil'];

/** Classify one source expression for a date field. Never guesses: an
 *  expression it cannot read is a failure, not a pass. */
export function utcMidnightVerdict(expr) {
    const raw = String(expr ?? '').trim().replace(/,$/, '');
    if (raw === '' ) return { kind: 'unreadable', raw };
    if (raw === 'null') return { kind: 'skip', raw };
    // Date.UTC(y, m, d) with exactly three arguments is midnight by definition.
    if (/^Date\.UTC\(\s*-?\d+\s*,\s*-?\d+\s*,\s*-?\d+\s*\)$/.test(raw)) {
        return { kind: 'ok', raw };
    }
    if (/^-?\d+$/.test(raw)) {
        const ms = Number(raw);
        if (ms % MS_PER_UTC_DAY === 0) return { kind: 'ok', raw };
        const offHours = ((ms % MS_PER_UTC_DAY) / 3600000).toFixed(2);
        return { kind: 'off', raw, offHours };
    }
    return { kind: 'unreadable', raw };
}

// ---------------------------------------------------------------------------
// Load-bearing-sentence arm
// ---------------------------------------------------------------------------

/**
 * The statutory notice's closing sentence must appear EXACTLY ONCE.
 *
 * Zero and two are both failures, and the two-case is the interesting one. The
 * non-translatable registry already fails if the sentence disappears entirely,
 * so "at least one" is covered. What nothing covered is a SECOND copy: with two
 * in the tree, deleting one leaves every gate green while half the callers
 * silently render a notice missing the clause that makes it an allocation
 * statement rather than an attempt to shift a rendering fault onto the
 * inspector.
 *
 * The endorsement-claim half of statutory copy is NOT checked here. It already
 * has a gate -- `check-endorsement-copy.mjs`, which reads a wider scope than
 * this one and evaluates negation per clause. A second implementation of it
 * would be the copy that drifts.
 */
const DISCLAIMER_SOURCE = 'server/lib/statutory/disclaimer.ts';
const LOAD_BEARING = 'not made the inspector’s responsibility merely by this notice';

/** How many times the sentence occurs. `null` when the file cannot be read --
 *  which is a failure, never a skip: unreadable and absent look identical. */
export function countLoadBearing(source) {
    if (typeof source !== 'string') return null;
    return source.split(LOAD_BEARING).length - 1;
}
// ---------------------------------------------------------------------------
// Source-host arm
// ---------------------------------------------------------------------------

/**
 * A published revision's `sourceUrl` must point at an authority's own site.
 *
 * The watcher polls whatever URL a version row carries. Point it at a mirror
 * and "detection" is worse than absent: it reports faithfully on a copy that
 * may be years behind, so a revision changes and nothing goes off. Version
 * staleness bites before any other problem in this subsystem, and the mirrors
 * are real -- one well-known legal-information site still serves the 2012 text
 * of a form replaced in 2026.
 *
 * WARNING: the authority's own domain is NECESSARY, NOT SUFFICIENT. Measured
 * 2026-08-27 on the real site: the most guessable filename under the agency's
 * own forms directory served the SUPERSEDED revision, while the current one
 * lived at a different path. So this arm can only catch the wrong HOST. Which
 * document at that host is the right one is a question for the person filling
 * in `checkedBy`, and no gate here can answer it.
 *
 * The list is explicit rather than pattern-matched (no `.gov` rule): plenty of
 * mirrors sit on government-adjacent domains, and an authority outside the US
 * has no `.gov` at all.
 */
const AUTHORITY_HOSTS = new Set([
    'www.trec.texas.gov',
    'trec.texas.gov',
    'floir.gov',
    'www.floir.gov',
    // Citizens Property Insurance Corporation publishes its own four-point and
    // roof inspection forms, on its own site, and no agency republishes them.
    // The "authority" a version is watched against is whoever PUBLISHES the
    // document, which for a carrier-issued form is the carrier -- pointing the
    // watcher at a state agency instead would poll a page these forms never
    // appear on, and report faithfully that nothing had changed.
    'www.citizensfla.com',
    'citizensfla.com',
]);

/** Verdict for one sourceUrl literal. Unreadable is a failure, never a skip. */
export function sourceHostVerdict(expr) {
    const raw = String(expr ?? '').trim().replace(/,$/, '').replace(/^['"`]|['"`]$/g, '');
    if (raw === '') return { kind: 'unreadable', raw };
    let host;
    try {
        host = new URL(raw).host;
    } catch {
        return { kind: 'unreadable', raw };
    }
    return AUTHORITY_HOSTS.has(host)
        ? { kind: 'ok', host }
        : { kind: 'mirror', host };
}
if (process.argv.includes('--self-test')) {
    // A gate nobody can see fail is a gate nobody can trust on the day it is
    // quiet -- and today the catalogue is empty, so the arm above examines
    // nothing on every deployment. These are its only exercise.
    const cases = [
        ['Date.UTC(2026, 3, 1)', 'ok'],
        [String(Date.UTC(2026, 3, 1)), 'ok'],
        [String(Date.UTC(2026, 3, 1) - 8 * 3600000), 'off'],
        ['null', 'skip'],
        ['someVariable', 'unreadable'],
        ['', 'unreadable'],
    ];
    let bad = 0;
    for (const [input, want] of cases) {
        const got = utcMidnightVerdict(input).kind;
        if (got !== want) {
            bad += 1;
            console.log(`  ✘ self-test: "${input}" -> ${got}, expected ${want}`);
        }
    }

    // The load-bearing arm, exercised on strings rather than on the file, so it
    // is checked even on a tree where the module has been moved.
    const sentenceCases = [
        [`x ${LOAD_BEARING} y`, 1],
        [`${LOAD_BEARING} and again ${LOAD_BEARING}`, 2],
        ['no such sentence here', 0],
        [null, null],
    ];
    for (const [input, want] of sentenceCases) {
        const got = countLoadBearing(input);
        if (got !== want) {
            bad += 1;
            console.log(`  ✘ self-test: countLoadBearing(${JSON.stringify(input)}) -> ${got}, expected ${want}`);
        }
    }

    // The host arm. The mirror case is the one that matters: it is the failure
    // this arm exists for, and a gate that cannot be seen rejecting a mirror
    // cannot be trusted to reject one.
    const hostCases = [
        ["'https://www.trec.texas.gov/forms/rei-7-6.pdf'", 'ok'],
        ["'https://floir.gov/docs-sf/x.pdf'", 'ok'],
        ["'https://www.law.cornell.edu/mirror/1802.pdf'", 'mirror'],
        ["'https://example.gov/1802.pdf'", 'mirror'],
        ['someVariable', 'unreadable'],
        ["''", 'unreadable'],
    ];
    for (const [input, want] of hostCases) {
        const got = sourceHostVerdict(input).kind;
        if (got !== want) {
            bad += 1;
            console.log(`  ✘ self-test: sourceHostVerdict(${input}) -> ${got}, expected ${want}`);
        }
    }
    const total = cases.length + 4 + 6;
    console.log(`statutory-fidelity --self-test: ${total} case(s) / ${total - bad} as expected.`);
    if (bad > 0) {
        console.log('  The arm cannot be trusted on real data if it misreads its own fixtures.');
        process.exit(1);
    }
    console.log('✅ self-test passed — the UTC-midnight arm fails on a local-time date and passes on a UTC one.');
    process.exit(0);
}

let dateFieldsSeen = 0;
let dateFieldsUtc = 0;
let dateFieldsSkipped = 0;

for (const form of forms) {
    const name = form.file.replace(/\.ts$/, '');
    for (const field of DATE_FIELDS) {
        // Doubled backslashes on purpose. This is a TEMPLATE LITERAL, so the
        // STRING parser reads the escapes before the regex engine ever sees
        // them: a single `\s` becomes a literal `s`, turning "skip whitespace"
        // into "optionally match the letter s", and a single `\n` becomes a
        // real newline. The pattern still compiled and still matched, which is
        // why nothing noticed -- CodeQL did, as js/useless-regexp-character-escape.
        // To end of LINE, not to the next comma. `utcMidnightVerdict` blesses
        // `Date.UTC(y, m, d)` by name -- and that expression contains commas, so
        // stopping at one captured `Date.UTC(2025` and the gate rejected the
        // very spelling its own verdict function is written to accept. The two
        // halves disagreed for as long as both existed; an empty catalogue is
        // why nothing said so. The verdict strips one trailing comma itself.
        const m = new RegExp(`${field}:\\s*([^\\n]+)`).exec(form.source);
        if (m === null) continue;
        dateFieldsSeen += 1;
        const verdict = utcMidnightVerdict(m[1]);
        if (verdict.kind === 'ok') dateFieldsUtc += 1;
        else if (verdict.kind === 'skip') dateFieldsSkipped += 1;
        else if (verdict.kind === 'off') {
            failures.push(`  ✘ ${name}.${field} is ${verdict.offHours}h off a UTC midnight. `
                + 'A revision dated in local time selects the wrong document on the cutover day, '
                + 'and the wrong document is a real official form.');
        } else {
            failures.push(`  ✘ ${name}.${field} could not be read as a date (${verdict.raw}). `
                + 'Unreadable is a failure here, never a pass.');
        }
    }
}

// An empty catalogue examining nothing is honest. A POPULATED catalogue
// examining nothing is the reading instrument having broken, and it looks
// identical from the outside -- both print 0. The regex above was wrong for as
// long as it existed and this line would not have caught it, because there were
// no forms to read; the moment someone adds the first one, a still-broken
// matcher must be loud rather than green.
if (forms.length > 0 && dateFieldsSeen === 0) {
    failures.push(`  ✘ ${forms.length} form module(s) present and NOT ONE date field was read. `
        + `Every module declares at least one of ${DATE_FIELDS.join(', ')}, so zero means this `
        + 'check stopped being able to see them -- which is a failure of the check, not a pass '
        + 'for the forms.');
}

// Printed on EVERY run, including the zeroes. Today the catalogue is empty on
// every deployment, so all three of these are 0 -- and a 0 that a tick swallows
// is how a gate comes to look healthy while examining nothing.
const disclaimerPath = join(root, DISCLAIMER_SOURCE);
const disclaimerSource = existsSync(disclaimerPath) ? readFileSync(disclaimerPath, 'utf8') : null;
const loadBearingCount = countLoadBearing(disclaimerSource);
if (loadBearingCount === null) {
    failures.push(`  ✘ ${DISCLAIMER_SOURCE} could not be read, so the statutory notice's `
        + 'closing sentence is UNCHECKED. Unreadable is a failure here: it looks exactly like absent.');
} else if (loadBearingCount === 0) {
    failures.push(`  ✘ the statutory notice's closing sentence is missing from ${DISCLAIMER_SOURCE}. `
        + 'Without it the notice stops being an allocation statement and becomes an ineffective '
        + 'attempt to make a rendering fault the inspector’s problem.');
} else if (loadBearingCount > 1) {
    failures.push(`  ✘ the statutory notice's closing sentence occurs ${loadBearingCount} times in `
        + `${DISCLAIMER_SOURCE}. With two copies, deleting one leaves every gate green while half the `
        + 'callers render a notice that no longer allocates anything.');
}

let hostsSeen = 0;
let hostsAuthoritative = 0;

for (const form of forms) {
    const name = form.file.replace(/\.ts$/, '');
    const m = form.source.split(String.fromCharCode(10)).map((line) => /sourceUrl:\s*(\S+)/.exec(line)).find(Boolean);
    // `!m`, not `m === null`. The guard a few blocks up reads `=== null` and is
    // right there, because its producer is `.exec()`. This one's producer is
    // `.find()`, which yields UNDEFINED when nothing matches -- so the copied
    // guard never fired and `m[1]` threw a TypeError on the first form module
    // that declared no sourceUrl. A gate that crashes still fails loudly; this
    // one would have failed while saying nothing about the form.
    if (!m) continue;
    hostsSeen += 1;
    const verdict = sourceHostVerdict(m[1]);
    if (verdict.kind === 'ok') hostsAuthoritative += 1;
    else if (verdict.kind === 'mirror') {
        failures.push(`  ✘ ${name}.sourceUrl points at "${verdict.host}", which is not an `
            + 'authority host. A watcher aimed at a mirror reports faithfully on a copy that may be '
            + 'years behind, so a revision can change with nothing going off.');
    } else {
        failures.push(`  ✘ ${name}.sourceUrl could not be read as a URL (${verdict.raw}). `
            + 'Unreadable is a failure here, never a pass.');
    }
}

console.log(`statutory-source-hosts: ${hostsSeen} sourceUrl(s) examined / ${hostsAuthoritative} on an `
    + `authority host (${AUTHORITY_HOSTS.size} host(s) allowed).`);

console.log(`statutory-notice: closing sentence found ${loadBearingCount === null ? 'UNREADABLE' : loadBearingCount} `
    + `time(s) in 1 declared source (exactly 1 required).`);

console.log(`statutory-utc-dates: ${dateFieldsSeen} date field(s) examined / `
    + `${dateFieldsUtc} on a UTC midnight · ${dateFieldsSkipped} null and skipped.`);

console.log(`statutory-detection: ${detection.length}/${DETECTION_FILES.length} detection file(s) `
    + `scanned · ${adopters.length} reaching statutory_form_versions · matcher control `
    + `${controlSees ? 'sees' : 'MISSES'} the known occurrence · registry admission check applied `
    + `${admissionUses} time(s).`);

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
    // The detect/adopt checks are about the WATCHER, not about the catalogue,
    // so an empty catalogue must not carry them out of the building with it.
    // Before this line a broken separation passed on every deployment that had
    // published nothing yet — which is every deployment, today.
    if (failures.length) {
        console.log(`\n✘ Statutory-fidelity gate — ${failures.length} problem(s):`);
        console.log(failures.join('\n'));
        process.exit(1);
    }
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
