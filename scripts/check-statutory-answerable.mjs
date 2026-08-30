/**
 * Can every answer this software accepts actually appear on the form?
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 * What an inspector enters must correspond to something on the authority's
 * page. The one exception is the inspection's own basic attributes -- property
 * address, inspector name, licence number, dates -- which are properties of the
 * inspection rather than answers to the form's questions, and which the form
 * asks for in its header wherever it asks at all.
 *
 * ── What this gate actually checks, which is narrower ───────────────────────
 * The general rule is not decidable from a field map: "is this the right box"
 * needs a person, which is what `checkedBy` is. What IS decidable is the case
 * where the software offers an answer that the page has NOWHERE TO RECORD:
 *
 *   an "Other" option with no blank beside it and no comments box to explain in.
 *
 * Measured 2026-08-29 on the Citizens four-point form: `electrical.wiring_types`
 * offers `other`, the page prints a bare "Other" with nothing after it, and that
 * section has no comments block. An inspector who picks it sends an insurer a
 * lone X. The insurer learns that the wiring is something -- and not what.
 *
 * ── Why "Other (explain)" is NOT a finding ─────────────────────────────────
 * Several forms print "Other (explain)" and mean the explanation goes in the
 * section's own comments block, which the same page carries. That is a
 * destination, so it passes: the group's `overflowTo` or a sibling description
 * overlay both count. The gate is looking for answers with NO destination at
 * all, not for answers whose destination is somewhere else on the page.
 *
 * ── And where the page genuinely has none ──────────────────────────────────
 * Three options across the four published forms are unanswerable on the
 * authority's own page, and no field map can invent a blank the publisher did
 * not print. They are listed one by one in `ACKNOWLEDGED` below, each with the
 * measured evidence and with where a person actually writes the explanation,
 * and each is PRINTED IN FULL on every run beside the counts. That is the
 * difference between recording a finding and deleting one. An option not on the
 * list still fails, and an entry that stops matching anything fails too --
 * a forgiveness that outlives the thing it forgave is a widened gate nobody
 * decided to widen.
 *
 * ── What it cannot do ──────────────────────────────────────────────────────
 * ⚠️ It reads the published catalogue, and a catalogue with no `other` options
 * examines nothing. It PRINTS the number rather than a tick, because a gate
 * that examined nothing and a clean result look identical from outside, and
 * this repository has fixed four gates that failed exactly that way.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FORMS_DIR = join(ROOT, 'server/lib/statutory/forms');

/** A value that offers "something else" rather than a named choice. */
const OTHER_VALUE = /^other(_|$)|_other$/i;

/** A field that exists to say WHAT the other thing was. */
const DESCRIBES_OTHER = /other/i;

/**
 * The part of a field name that says WHICH PART OF THE FORM it belongs to.
 *
 * ⚠️ IT SPLITS ON BOTH SEPARATORS, and that is a fix rather than a tidy-up. The
 * first version split on `.` alone, which is the Citizens forms' convention
 * (`electrical.wiring_types`). FL OIR-B1-1802 uses `_` throughout and contains
 * no dot at all, so every one of its field names was ONE segment: the whole
 * name. `roof_covering_types` and the blank the form prints beside its Other row
 * -- `roof_covering_other_description`, which the map names and which renders --
 * therefore shared no prefix, and the gate reported an option with nowhere to go
 * against a form that has one. A destination-finder that cannot see any
 * destination on a whole form reports the same thing as a form with none.
 */
function area(ourField) {
    return ourField.split(/[._]/)[0];
}

/**
 * Options that ARE unanswerable on the authority's own page, acknowledged one
 * by one rather than made to disappear.
 *
 * ── Why declared here and not fixed in the map ──────────────────────────────
 * None of these is our mistake to correct. The publisher prints the box and
 * prints nothing beside it; a field map may only name what the document has.
 * The choices are to record the finding or to stop offering the option, and
 * dropping it is worse: the form asks the question, and an inspector who cannot
 * answer it here answers it on paper.
 *
 * Every entry names the measured evidence and where a person actually writes
 * the explanation. Each is PRINTED on every run beside the counts, so this list
 * is a standing report rather than a silence, and an option that is NOT on it
 * still fails the gate.
 */
const ACKNOWLEDGED = [
    {
        form: 'fl-citizens-4point',
        ourField: 'electrical.wiring_types',
        whenValue: 'other',
        because: 'the Supplemental information table prints a bare "Other" checkbox with no rule '
            + 'and no blank after it, and the Electrical System section carries no comments block '
            + 'of its own. The explanation goes in the form\'s own Additional Comments/Observations '
            + 'box on the next page, which this map names as `additional_comments` -- typed by the '
            + 'inspector, because the page gives nothing to route it into.',
    },
    {
        form: 'fl-citizens-4point',
        ourField: 'electrical.hazards_present',
        whenValue: 'other_explain',
        because: 'the form prints "Other (explain)" and then prints nowhere to explain. Same '
            + 'section, same absence, same destination as the row above: `additional_comments` on '
            + 'the next page.',
    },
    {
        form: 'fl-oir-b1-1802',
        ourField: 'inspector_qualification',
        whenValue: 'other_recognized_by_insurer',
        because: 'this option is a whole printed sentence -- "Any other individual or entity '
            + 'recognized by the insurer as possessing the necessary qualifications" -- and the '
            + 'block directly above it prints "License Type:" and "License or Certificate #:", '
            + 'both of which this map names (`inspector_license_type`, `inspector_license_number`). '
            + 'The reader learns what the qualification is from those two blanks. There is no '
            + '"other" field because the form asks for none.',
    },
];

/** Is this option acknowledged for THIS form? Matched on all three parts. */
function acknowledgementFor(name, ourField, whenValue) {
    return ACKNOWLEDGED.find(
        (a) => a.form === name && a.ourField === ourField && a.whenValue === whenValue,
    ) ?? null;
}

function formModules() {
    if (!existsSync(FORMS_DIR)) return [];
    return readdirSync(FORMS_DIR)
        .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
        .map((file) => ({ file, source: readFileSync(join(FORMS_DIR, file), 'utf8') }));
}

/**
 * `{ kind: 'checkbox', ourField: 'x', whenValue: 'y', … }` -> its three parts.
 *
 * ⚠️ THE KIND IS READ, NOT ENUMERATED. An earlier version listed
 * `(acroform|overlay|checkbox)`, and `acroform_checkbox` -- added the same day --
 * matched NOTHING. The count would have gone 245 -> 81 on a map that adopted it:
 * a PARTIAL read, above the fail-closed zero, and silent. That is the exact
 * failure this file's header warns about, in this file.
 *
 * So it matches any kind and REPORTS what it found. A kind nobody anticipated
 * shows up in the printed line rather than vanishing from the count.
 */
function mappingsOf(source) {
    const out = [];
    for (const m of source.matchAll(/\{[^{}]*kind:\s*'([a-z_]+)'[^{}]*\}/g)) {
        const body = m[0];
        const ourField = /ourField:\s*'([^']*)'/.exec(body)?.[1];
        if (ourField === undefined) continue;
        const whenValue = /whenValue:\s*'([^']*)'/.exec(body)?.[1];
        out.push({ kind: m[1], ourField, whenValue });
    }
    return out;
}

/** Every field that could receive an explanation, from THIS form's own map. */
function destinationsIn(mappings) {
    return new Set(
        mappings
            .filter((m) => m.kind !== 'checkbox' && DESCRIBES_OTHER.test(m.ourField))
            .map((m) => m.ourField),
    );
}

// ── The matcher's own fixtures, scored on every run ─────────────────────────
// Not behind a flag. The catalogue can legitimately contain zero "other"
// options, so the real scan can read nothing at all -- and then the only thing
// standing between this file and a green tick that means nothing is whether its
// reader still works.
const KIND_FIXTURES = [
    // One per kind the union carries today, plus one it does not, so that a new
    // kind is caught by this list failing rather than by the count quietly
    // shrinking. `acroform_checkbox` is here because listing kinds by hand is
    // what broke this reader once already.
    { src: "{ kind: 'acroform', ourField: 'a', pdfField: 'p' },", expect: 1 },
    { src: "{ kind: 'overlay', ourField: 'b', page: 0, x: 1, y: 2 },", expect: 1 },
    { src: "{ kind: 'checkbox', ourField: 'c', whenValue: 'v', page: 0, x: 1, y: 2 },", expect: 1 },
    { src: "{ kind: 'acroform_checkbox', ourField: 'd', whenValue: 'v', pdfField: 'p' },", expect: 1 },
    { src: "{ ourField: 'e' },", expect: 0 },
];
const kindOk = KIND_FIXTURES.filter((c) => mappingsOf(c.src).length === c.expect).length;
console.log(`statutory-answerable: mapping-reader self-check ${kindOk} case(s) / ${KIND_FIXTURES.length} as expected.`);
if (kindOk !== KIND_FIXTURES.length) {
    console.log('  ✘ the mapping reader misses a kind it was shown, so any count it '
        + 'reports below is a floor rather than a total.');
    process.exit(1);
}

const SELF_TEST = [
    { v: 'other', expect: true },
    { v: 'other_explain', expect: true },
    { v: 'other_recognized_by_insurer', expect: true },
    { v: 'N_OTHER', expect: true },
    { v: 'not_present', expect: false },
    { v: 'brother', expect: false },
];
const selfOk = SELF_TEST.filter((c) => OTHER_VALUE.test(c.v) === c.expect).length;
console.log(`statutory-answerable: matcher self-check ${selfOk} case(s) / ${SELF_TEST.length} as expected.`);
if (selfOk !== SELF_TEST.length) {
    console.log('  ✘ the matcher misreads its own fixtures, so its verdict on the real '
        + 'catalogue means nothing.');
    process.exit(1);
}

// The destination-finder's own fixtures. Both separators, and BOTH VERDICTS:
// a reader that answered "same area" to everything would satisfy the first two
// cases perfectly and forgive every option on every form.
const AREA_FIXTURES = [
    { a: 'electrical.wiring_types', b: 'electrical.hazards_present', same: true },
    { a: 'roof_covering_types', b: 'roof_covering_other_description', same: true },
    { a: 'electrical.wiring_types', b: 'plumbing.pipe_type_other_specify', same: false },
    { a: 'inspector_qualification', b: 'roof_covering_other_description', same: false },
];
const areaOk = AREA_FIXTURES.filter((c) => (area(c.a) === area(c.b)) === c.same).length;
console.log(`statutory-answerable: destination-finder self-check ${areaOk} case(s) / `
    + `${AREA_FIXTURES.length} as expected.`);
if (areaOk !== AREA_FIXTURES.length) {
    console.log('  ✘ the destination-finder misreads its own fixtures. On a form whose names '
        + 'carry no dot it would find no destination anywhere, which reads exactly like a form '
        + 'that has none.');
    process.exit(1);
}

const forms = formModules();
const failures = [];
const acknowledgedHere = [];
let optionsSeen = 0;
let optionsWithSomewhere = 0;

for (const form of forms) {
    const name = form.file.replace(/\.ts$/, '');
    const mappings = mappingsOf(form.source);
    if (mappings.length === 0) {
        failures.push(`  ✘ ${form.file} parsed to zero mappings. This gate read the file and `
            + 'found nothing in it, which is a failure of the reader, not a pass for the form.');
        continue;
    }
    const destinations = destinationsIn(mappings);
    for (const m of mappings) {
        if (m.kind !== 'checkbox' || m.whenValue === undefined) continue;
        if (!OTHER_VALUE.test(m.whenValue)) continue;
        optionsSeen += 1;
        // A sibling that describes the other thing: same part of the form, and a
        // name that says so. `plumbing.pipe_types` -> `plumbing.pipe_type_other_specify`;
        // `roof_covering_types` -> `roof_covering_other_description`.
        const hasSomewhere = [...destinations].some((d) => area(d) === area(m.ourField));
        const acknowledged = acknowledgementFor(name, m.ourField, m.whenValue);
        if (hasSomewhere) {
            optionsWithSomewhere += 1;
        } else if (acknowledged !== null) {
            acknowledgedHere.push(acknowledged);
        } else {
            failures.push(`  ✘ ${name}: "${m.ourField}" offers "${m.whenValue}" and this form `
                + 'carries no field to say what the other thing was. An inspector who picks it '
                + 'sends a lone mark: the reader learns there is something and never what. '
                + 'Either map the blank the form prints beside it, or declare the group\'s '
                + '`overflowTo` so the explanation reaches the comments box.');
        }
    }
}

// Printed on EVERY run including the zeroes. TX TREC REI 7-6 has no "other"
// option at all, so 0 is the honest answer today -- and a 0 a tick swallows is
// how a gate comes to look healthy while examining nothing.
console.log(`statutory-answerable: ${forms.length} published form module(s) · `
    + `${optionsSeen} "other" option(s) examined / ${optionsWithSomewhere} with somewhere to say what `
    + `· ${acknowledgedHere.length} acknowledged as having none.`);

// The acknowledgements, in full, on every run. They are findings about the
// authorities' own pages, and a finding nobody reads is a finding that has been
// deleted -- so they print with the counts rather than being hidden behind a
// tick. Read them; do not extend the list to make a red run green.
for (const a of acknowledgedHere) {
    console.log(`  ⚠️ ${a.form}: "${a.ourField}" offers "${a.whenValue}" and the printed form has `
        + 'no blank beside it.');
    console.log(`     ${a.because}`);
}

// A stale acknowledgement is the same failure as a stale EMPTY_CATALOGUE_REASON:
// an explanation that outlives the state it explains. It also silently widens
// the gate -- an entry left behind would forgive the option the day it comes
// back, on a form nobody re-read.
const unusedAcknowledgements = ACKNOWLEDGED.filter(
    (a) => !acknowledgedHere.includes(a),
);
for (const a of unusedAcknowledgements) {
    failures.push(`  ✘ the acknowledgement for ${a.form} "${a.ourField}" = "${a.whenValue}" matched `
        + 'nothing on this run. Either the option gained somewhere to say what it was -- in which '
        + 'case delete the entry -- or the field was renamed and the entry now forgives an option '
        + 'nobody is looking at.');
}
// The kinds actually read, so a mapping shape nobody anticipated is visible in
// the output instead of being absent from the count.
const kindsSeen = forms.flatMap((f) => mappingsOf(f.source)).reduce((acc, m) => {
    acc[m.kind] = (acc[m.kind] ?? 0) + 1;
    return acc;
}, {});
console.log(`statutory-answerable: mapping kinds read — ${Object.entries(kindsSeen)
    .map(([k, n]) => `${k}:${n}`).join(' · ') || 'none'}.`);

if (failures.length > 0) {
    console.log(`  ✘ Statutory-answerable gate — ${failures.length} problem(s):`);
    for (const f of failures) console.log(f);
    process.exit(1);
}
if (forms.length === 0) {
    console.log('  ⊘ no published form modules — nothing to examine, and the empty catalogue '
        + 'is declared in forms/index.ts.');
}
console.log('✅ Statutory-answerable gate — every "other" this software offers either has '
    + 'somewhere on the page to say what it was, or is acknowledged above as having none.');
console.log('   ⚠️ This checks only that a DESTINATION exists. Whether the answer lands in the '
    + 'right box is what `checkedBy` is for, and no gate can do it.');
process.exit(0);
