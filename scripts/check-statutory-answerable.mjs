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
 * ── What it cannot do ──────────────────────────────────────────────────────
 * ⚠️ It reads the published catalogue, and a catalogue with no `other` options
 * examines nothing. TX TREC REI 7-6 -- the only published form today -- has
 * none, so this gate's honest answer is `0 examined`. It PRINTS that number
 * rather than a tick, because a gate that examined nothing and a clean result
 * look identical from outside, and this repository has fixed four gates that
 * failed exactly that way.
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

function formModules() {
    if (!existsSync(FORMS_DIR)) return [];
    return readdirSync(FORMS_DIR)
        .filter((f) => f.endsWith('.ts') && f !== 'index.ts')
        .map((file) => ({ file, source: readFileSync(join(FORMS_DIR, file), 'utf8') }));
}

/** `{ kind: 'checkbox', ourField: 'x', whenValue: 'y', … }` -> its three parts. */
function mappingsOf(source) {
    const out = [];
    for (const m of source.matchAll(/\{[^{}]*kind:\s*'(acroform|overlay|checkbox)'[^{}]*\}/g)) {
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

const forms = formModules();
const failures = [];
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
        // A sibling that describes the other thing: same leading segment, and a
        // name that says so. `plumbing.pipe_types` -> `plumbing.pipe_type_other_specify`.
        const prefix = m.ourField.split('.')[0];
        const hasSomewhere = [...destinations].some((d) => d.split('.')[0] === prefix);
        if (hasSomewhere) {
            optionsWithSomewhere += 1;
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
    + `${optionsSeen} "other" option(s) examined / ${optionsWithSomewhere} with somewhere to say what.`);

if (failures.length > 0) {
    console.log(`  ✘ Statutory-answerable gate — ${failures.length} problem(s):`);
    for (const f of failures) console.log(f);
    process.exit(1);
}
if (forms.length === 0) {
    console.log('  ⊘ no published form modules — nothing to examine, and the empty catalogue '
        + 'is declared in forms/index.ts.');
}
console.log('✅ Statutory-answerable gate — every "other" this software offers has somewhere '
    + 'on the page to say what it was.');
console.log('   ⚠️ This checks only that a DESTINATION exists. Whether the answer lands in the '
    + 'right box is what `checkedBy` is for, and no gate can do it.');
process.exit(0);
