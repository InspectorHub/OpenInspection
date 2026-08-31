#!/usr/bin/env node
/**
 * Has a statutory field map ever been rendered onto the authority's own PDF?
 *
 * ⚠️ THIS GATE NEVER RUNS AUTOMATICALLY. It reads files that are not in this
 * repository and must never be: they are the agencies' own published forms.
 * It is a release-time manual rung, run by a person who holds them, in the same
 * tier as `verify:real-corpus` beside it — not a CI job, because CI here runs on
 * a public repository and the forms are those agencies' documents to publish.
 *
 *   STATUTORY_PDF_DIR=/path/to/statutory-forms npm run verify:statutory-render
 *
 * Nothing is copied into this repository and nothing is written anywhere unless
 * `STATUTORY_RENDER_OUT` names a directory outside it (see below). The only
 * output is which values were confirmed to have reached the page, and which
 * were not.
 *
 * ── Why it exists at all ────────────────────────────────────────────────────
 * Everything else in this subsystem is satisfiable without ever meeting the
 * form. `check-statutory-fidelity.mjs` reads the map. `field-map.spec.ts` and
 * `render.spec.ts` render onto documents this repository invented — pages built
 * by pdf-lib, with the field names and the geometry the map already claims. A
 * map and a test that agree with each other about a form neither of them has
 * opened is exactly the failure this whole subsystem was built around, and it
 * is the one shape no test in the tree can catch.
 *
 * ── "It rendered" is an assertion the bug also satisfies ────────────────────
 * A date written as one string onto a form that prints three separate blanks
 * renders, prints and files, with the year sitting across the wrong blank. So
 * nothing here is judged by the absence of an exception. Every value is read
 * BACK out of the produced bytes:
 *
 *   acroform — the named field is fetched off the saved document and its text
 *              compared to what was supplied. A name that resolves to nothing
 *              sets nothing and raises nothing, so the names are ALSO looked up
 *              independently, in the untouched original, rather than trusting
 *              the renderer's own check of them.
 *   acroform_checkbox — the named widget is read back off the saved document and
 *              has to be TICKED, and every widget this answer did not choose has
 *              to be untouched. Read as field data rather than as ink on purpose:
 *              a mark drawn over a widget is visible on the printed page and
 *              leaves the box unticked in the file, which is the whole failure
 *              this kind exists to end.
 *   overlay  — the content stream is parsed and the run has to be at the
 *              coordinate the map names, carrying the text the value produces.
 *   checkbox — the mark has to be at the coordinate, AND every box this answer
 *              did NOT choose has to be empty. A renderer that marks all four
 *              boxes of a four-way rating satisfies "the mark is there".
 *
 * The runs are compared against the SAME parse of the untouched original, so a
 * run only counts when this render put it there. An agency's own page carries
 * hundreds of text objects and some of them say the same words.
 *
 * ── Both numbers, every run ─────────────────────────────────────────────────
 * Fields the map names, fields the test data covers, and fields verified
 * present on the page are printed side by side whether the run is green or red.
 * A harness that examined nothing and a clean run look identical from outside,
 * so a missing variable, an unreadable PDF, a missing values file, zero forms
 * examined and zero fields verified are each an error rather than a quiet pass.
 *
 * ── What this replaced, and what it carried forward ────────────────────────
 * An earlier script of this name took `--map` and `--pdf`, rendered ONE form,
 * and wrote a `slots.json` for a person to check placement against by hand. Its
 * two arguments are now the FORMS table below, and its reader is the read-back
 * further down, which measures the placement instead of describing it. Nothing
 * it could do was dropped: the value collector, the positional slot names it
 * produces, and what becomes of one instance more than the form has columns —
 * refused where the block nominates nowhere to put it, routed into the box the
 * form does nominate and then FOUND there — are all still exercised, in
 * `checkTheValueCollector`, on every run.
 *
 * ── What it cannot see, stated so a green run is not read as more than it is ─
 * It proves a value landed at the coordinate the map names. It cannot prove the
 * map names the right coordinate. That failure renders, prints and files with
 * only the content wrong, and only a person holding the form beside the output
 * catches it — which is what `STATUTORY_RENDER_OUT` is for.
 */
import {
    existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { join, resolve, dirname, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import {
    PDFDocument, PDFName, PDFArray, PDFRawStream, StandardFonts, decodePDFRawStream,
} from 'pdf-lib';
import { renderStatutoryForm } from '../server/lib/statutory/render.ts';
import { collectStatutoryValues } from '../server/lib/statutory/values.ts';
import { partOfValue } from '../server/lib/statutory/value-parts.ts';
import { fieldMap as trecRei76Map } from '../server/lib/statutory/forms/tx-trec-rei-7-6.ts';
import { fieldMap as flCitizens4pointMap } from '../server/lib/statutory/forms/fl-citizens-4point.ts';
import { fieldMap as flCitizensRoofMap } from '../server/lib/statutory/forms/fl-citizens-roof.ts';
import { fieldMap as flOirB11802Map } from '../server/lib/statutory/forms/fl-oir-b1-1802.ts';
import { drawnRuns, runsInContentStream } from '../tests/unit/helpers/pdf-drawn-runs.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The signature this harness substitutes when a candidate carries none.
 *
 * A map with no `checkedBy` is refused by `validateFieldMapShape` before any
 * geometric rule runs — so ONE missing signature hides every mis-measured
 * coordinate behind it, and the person who signs it then discovers the rest one
 * refusal at a time. The form is still reported as FAILED; this only decides
 * whether the failure comes with the rest of the findings attached.
 *
 * It is worded so it can never be read as a person having checked anything.
 */
const UNSIGNED_SENTINEL = '(unsigned candidate: verify:statutory-render sentinel)';

/** The mark `render.ts` draws into a checkbox. */
const MARK = 'X';

/**
 * Does this answer name that box?
 *
 * The same rule `render.ts` applies, restated here rather than imported because
 * this file is the INDEPENDENT reader: importing the renderer's own predicate
 * would make a wrong one agree with itself.
 */
/**
 * Two answers that mean the same thing.
 *
 * `===` is wrong for a list and wrong SILENTLY: two arrays of the same options
 * are never the same object, so every multi-select answer would be reported as
 * a mismatch and the real ones would be lost in the noise.
 */
function sameAnswer(a, b) {
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b)
            && a.length === b.length && a.every((v, i) => v === b[i]);
    }
    return a === b;
}

function answerNames(value, whenValue) {
    return Array.isArray(value) ? value.includes(whenValue) : value === whenValue;
}

/** How far a run may sit from the coordinate the map names, in points. */
const COORDINATE_TOLERANCE = 0.02;

/**
 * Every statutory form this harness knows about.
 *
 * ⚠️ ALL FOUR NOW RENDER THROUGH THE PUBLISHED MODULE, not through the
 * candidate JSON beside the PDFs. That is the point: the candidate is the
 * artifact a person signed, and the module is the software an inspector's
 * document comes out of. Verifying the candidate proved something about a file
 * nothing imports. The `candidate` key stays on every row so the sweep at the
 * end can tell "covered through the module generated from it" from "nothing has
 * ever rendered this" — two states that look identical in a directory listing.
 * Whether a module has since drifted from the candidate it was generated from
 * is `lint:statutory-fidelity`'s question, not this one's.
 *
 * The `map: null` arm below it is kept even though no row uses it today. It is
 * how a form whose bytes are held but whose map does not exist yet is declared
 * — and the declaration has to outlive the particular form that needed it, or
 * the next one gets quietly dropped off the list instead.
 */
const FORMS = [
    {
        formId: 'tx_trec_rei',
        label: 'TX TREC REI 7-6',
        pdf: 'tx-trec-rei-7-6-fillable.pdf',
        map: { kind: 'published', module: 'server/lib/statutory/forms/tx-trec-rei-7-6.ts', value: trecRei76Map },
        candidate: 'tx-trec-rei-7-6.candidate.json',
        values: 'tests/fixtures/statutory/tx-trec-rei-7-6.values.json',
    },
    {
        formId: 'fl_oir_b1_1802',
        label: 'FL OIR-B1-1802',
        pdf: 'floir-oir-b1-1802-rev-04-26-CURRENT.pdf',
        map: { kind: 'published', module: 'server/lib/statutory/forms/fl-oir-b1-1802.ts', value: flOirB11802Map },
        candidate: 'fl-oir-b1-1802-rev-04-26.candidate.json',
        values: 'tests/fixtures/statutory/fl-oir-b1-1802-rev-04-26.values.json',
    },
    {
        formId: 'fl_citizens_4point',
        label: 'FL Citizens 4-Point',
        pdf: 'fl-citizens-4point-Insp4pt-03-25.pdf',
        map: { kind: 'published', module: 'server/lib/statutory/forms/fl-citizens-4point.ts', value: flCitizens4pointMap },
        candidate: 'fl-citizens-4point-insp4pt-03-25.candidate.json',
        values: 'tests/fixtures/statutory/fl-citizens-4point-insp4pt-03-25.values.json',
    },
    {
        // ⚠️ `fl_citizens_roof`, with no revision in it. This row said
        // `fl_citizens_roof_rcf_1` while it rendered nothing, and a form id
        // nothing selects by is a string no reader can be wrong about. It is
        // the published id now, and the published id is what the map carries.
        formId: 'fl_citizens_roof',
        label: 'FL Citizens Roof RCF-1',
        pdf: 'fl-citizens-roof-RCF-1-03-25.pdf',
        map: { kind: 'published', module: 'server/lib/statutory/forms/fl-citizens-roof.ts', value: flCitizensRoofMap },
        candidate: 'fl-citizens-roof-rcf-1-03-25.candidate.json',
        values: 'tests/fixtures/statutory/fl-citizens-roof-rcf-1-03-25.values.json',
    },
];

function line(text = '') {
    console.log(text);
}

console.log('Statutory-render verification — the PRIVATE gate.');
console.log('  Never runs in CI. Reads the authorities\' own published PDFs, which are not, and');
console.log('  must not be, in this repository.');
line();

const pdfDir = process.env.STATUTORY_PDF_DIR;
if (!pdfDir) {
    line('  STATUTORY_PDF_DIR is not set, so no form was read.');
    line(`  ${FORMS.length} form(s) declared · ${FORMS.filter((f) => f.map).length} carry a map.`);
    line('✘ Cannot verify without the forms. Set STATUTORY_PDF_DIR to the directory holding them.');
    process.exit(1);
}
if (!existsSync(pdfDir) || !statSync(pdfDir).isDirectory()) {
    line(`✘ STATUTORY_PDF_DIR points at ${pdfDir}, which is not a directory.`);
    process.exit(1);
}

/**
 * The candidate maps come from `candidates/` beside the PDFs, and there is no
 * second variable for them.
 *
 * They are one downloaded corpus with one provenance record: the candidates
 * name the sha256 of the PDFs sitting next to them, and the note recording where
 * each file came from covers both halves. A second variable's only new power
 * would be to point the two halves at different downloads, which is a way to be
 * wrong that does not currently exist.
 */
const candidateDir = join(pdfDir, 'candidates');
if (!existsSync(candidateDir)) {
    line(`✘ No candidates/ directory beside the PDFs (looked in ${candidateDir}).`);
    line('  The candidate field maps live there. They are not in this repository either.');
    process.exit(1);
}

/**
 * Where a rendered form may be written for a person to hold beside the original.
 *
 * Refused inside this repository, whatever the variable says. The output is the
 * agency's document with somebody's answers on it, and the one rule this file
 * exists under is that neither ever lands here.
 */
const outDir = process.env.STATUTORY_RENDER_OUT ?? null;
if (outDir !== null) {
    const abs = isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir);
    const inside = relative(ROOT, abs);
    if (inside === '' || (!inside.startsWith('..') && !isAbsolute(inside))) {
        line(`✘ STATUTORY_RENDER_OUT points at ${abs}, which is inside this repository.`);
        line('  A rendered statutory form is the authority\'s document with answers on it.');
        line('  Name a directory outside the repository, or leave the variable unset.');
        process.exit(1);
    }
    mkdirSync(abs, { recursive: true });
}

/**
 * 🔴 DELIBERATELY NOT `server/lib/sha256.ts`, though this file imports plenty of
 * other things from `server/`.
 *
 * One of the things this script checks is that a published map's `sourceHash`
 * matches the authority's PDF -- the same comparison `field-map.ts` makes at
 * runtime with the shared helper. A verifier that imported the implementation it
 * is verifying could not report a fault in that implementation; it would agree
 * with it. Node's `createHash` is a second, independent implementation, which is
 * the whole value of the copy.
 *
 * The two were compared before the other eight were merged: identical output on
 * a known vector, the empty input, non-ASCII text and bytes including NUL.
 */
function sha256Hex(bytes) {
    return createHash('sha256').update(bytes).digest('hex');
}

/** A candidate JSON turned into the shape `renderStatutoryForm` takes. */
function candidateToFieldMap(json) {
    const signed = typeof json.checkedBy === 'string' && json.checkedBy.trim() !== ''
        && typeof json.checkedAt === 'string' && Number.isFinite(Date.parse(json.checkedAt));
    return {
        signed,
        checkedBy: signed ? json.checkedBy : undefined,
        checkedAt: signed ? json.checkedAt : undefined,
        map: {
            formId: json.formId,
            version: json.version,
            sourceHash: json.sourceHash,
            checkedBy: signed ? json.checkedBy : UNSIGNED_SENTINEL,
            // The candidate records a calendar day; the map takes epoch ms.
            checkedAt: signed ? Date.parse(json.checkedAt) : Date.UTC(1970, 0, 2),
            requiredFields: json.requiredFields ?? [],
            mappings: json.mappings ?? [],
            // Carried through rather than dropped: the repeated blocks are what
            // the value collector is checked against, and a map that declares
            // them is the only place positional addressing can be exercised.
            groups: json.groups ?? [],
        },
    };
}

/** Counting key for one drawn run: the text, where it sits, and how big it is. */
function runKey(run) {
    return `${run.text}\u0000${run.x.toFixed(2)}\u0000${run.y.toFixed(2)}\u0000${run.size}`;
}

/**
 * The runs THIS render added, page by page.
 *
 * A multiset difference rather than a set one: the agency's own page draws the
 * same short strings many times, and treating the before-picture as a set would
 * let the second copy of one of them stand in for a value we never wrote.
 */
async function addedRuns(before, after, pageCount) {
    const pages = [];
    for (let page = 0; page < pageCount; page += 1) {
        const had = new Map();
        for (const run of await drawnRuns(before, page)) {
            had.set(runKey(run), (had.get(runKey(run)) ?? 0) + 1);
        }
        const added = [];
        for (const run of await drawnRuns(after, page)) {
            const key = runKey(run);
            const remaining = had.get(key) ?? 0;
            if (remaining > 0) had.set(key, remaining - 1);
            else added.push(run);
        }
        pages.push(added);
    }
    return pages;
}

/** Runs added at one coordinate, in the order they were written. */
function runsAt(added, page, x, y) {
    return (added[page] ?? []).filter(
        (r) => Math.abs(r.x - x) <= COORDINATE_TOLERANCE && Math.abs(r.y - y) <= COORDINATE_TOLERANCE,
    );
}

/** Whitespace-insensitive comparison, reported by which form of it matched. */
function textMatches(found, expected) {
    const collapse = (s) => s.replace(/\s+/g, ' ').trim();
    const strip = (s) => s.replace(/\s+/g, '');
    if (collapse(found) === collapse(expected)) return 'exact';
    if (strip(found) === strip(expected)) return 'rewrapped';
    return null;
}

/**
 * Where a filled form field's text actually landed, and whether its own box
 * kept it.
 *
 * ── The failure this exists to catch ────────────────────────────────────────
 * A form field's value is not drawn on the page. Setting it makes pdf-lib
 * GENERATE that widget's appearance stream, and everything about whether the
 * answer is readable happens in there: the stream carries its own BBox, its own
 * clip path, and lines laid out from the top down. A line whose baseline falls
 * below that clip is drawn and never seen. The field still reads back correctly,
 * the page's own content stream is untouched, and every assertion about the
 * value holds.
 *
 * `refuseIfTheWidgetWouldClip` is supposed to stop that before it happens, and
 * it measures line height with `heightAtSize`. What pdf-lib then LAYS OUT with
 * is a larger step — measured on the TREC form, 11.1pt per line against the
 * 9.25pt the refusal budgeted, at the same 10pt size. So the check can pass a
 * value the produced document clips, which is the one thing it exists to
 * prevent. Reading the appearance back does not depend on knowing either
 * number.
 *
 * Returns null when the widget carries no appearance stream to read.
 */
function clippedLinesInAppearance(doc, field, ruler) {
    const problems = [];
    for (const widget of field.acroField.getWidgets()) {
        const ref = widget.getNormalAppearance();
        const stream = ref instanceof PDFRawStream ? ref : doc.context.lookup(ref);
        if (!(stream instanceof PDFRawStream)) continue;
        const box = stream.dict.get(PDFName.of('BBox'));
        if (!(box instanceof PDFArray) || box.size() !== 4) continue;
        const [bx0, by0, bx1, by1] = box.asArray().map((n) => n.asNumber());

        let text = '';
        for (const byte of decodePDFRawStream(stream).decode()) text += String.fromCharCode(byte);
        for (const run of runsInContentStream(text)) {
            if (run.text.trim() === '') continue;
            // Helvetica's descender is 207/1000 of the em and its ascender
            // 718/1000. pdf-lib writes /Helvetica into the appearance it
            // generates, whatever the form's own DA names, so these are the
            // metrics of the glyphs actually in the stream.
            const bottom = run.y - 0.207 * run.size;
            const top = run.y + 0.718 * run.size;
            const right = run.x + ruler.widthOfTextAtSize(run.text, run.size);
            if (bottom < by0 - 0.01) {
                problems.push(`the line ${JSON.stringify(run.text.slice(0, 40))} sits at baseline `
                    + `${run.y.toFixed(2)} in a box whose floor is ${by0.toFixed(2)} — `
                    + `${(by0 - bottom).toFixed(2)}pt of it is below the clip`);
            } else if (top > by1 + 0.01) {
                problems.push(`the line ${JSON.stringify(run.text.slice(0, 40))} rises to `
                    + `${top.toFixed(2)} in a box whose ceiling is ${by1.toFixed(2)}`);
            }
            if (right > bx1 + 0.5) {
                problems.push(`the line ${JSON.stringify(run.text.slice(0, 40))} runs to `
                    + `${right.toFixed(2)} in a box ${bx1.toFixed(2)} wide`);
            }
        }
    }
    return problems;
}

/**
 * The half of the path that happens BEFORE the renderer: a template declaration
 * with repeated blocks, run through the real value collector.
 *
 * ── Why this is here and not left to the unit tests ─────────────────────────
 * `electrical_panel[0]` and `electrical_panel[1]` are two COLUMNS of one row on
 * the Citizens four-point form. A collector that wrote slot 0 into both, or
 * swapped them, produces a form that prints, is the right length, and passes
 * every assertion about its own values. Only running the real collector into
 * the real renderer onto the real page can tell those apart, and this is the
 * only place all three meet.
 *
 * ── What is asserted ────────────────────────────────────────────────────────
 * That the collector, given a declaration built from the same data the render
 * used, reproduces that data EXACTLY — key for key, including every positional
 * slot name. Anything less and the page check below is verifying values this
 * software would never actually have produced.
 *
 * ── And what happens past the last slot ────────────────────────────────────
 * A house with one more panel than the form has columns. A dropped instance
 * comes out as an empty slot, and an empty slot reads exactly like an inspector
 * who did not answer, so it must never be quietly truncated. WHERE it goes is
 * the declaration's to say, and the two halves are asserted separately:
 *
 *   no `overflowTo` — there is genuinely nowhere on the page, so the collector
 *      must REFUSE, and the refusal has to name BOTH counts and where the
 *      remainder goes: a person reading it is standing in a garage deciding what
 *      to do next, and "too many panels" is a wall. Unchanged, and it is the
 *      only protection such a group has.
 *   `overflowTo` — the form itself nominates a box ("use additional pages if
 *      needed"), so the collector must ACCEPT, and the extra instance's own text
 *      is then read back OUT of that box and off the produced page. Accepting
 *      without reading it back would be worse than refusing: a third panel that
 *      disappears quietly is the same empty slot, with no refusal to notice it.
 *      So this branch never stops looking — it looks somewhere else.
 *
 * Both halves run on EVERY group. This checked `groups[0]` while the Citizens
 * four-point form declared two, so its roof block was never once exercised.
 */
async function checkTheValueCollector(map, values, official) {
    const groups = map.groups ?? [];
    if (groups.length === 0) return { ran: false, problems: [] };

    const problems = [];
    const grouped = new Set();
    const instances = {};
    for (const group of groups) {
        instances[group.id] = [];
        for (let index = 0; index < group.capacity; index += 1) {
            const instance = {};
            for (const field of group.fields) {
                const ourField = `${group.id}[${index}].${field}`;
                if (!Object.hasOwn(values, ourField)) continue;
                grouped.add(ourField);
                instance[field] = values[ourField];
            }
            instances[group.id].push(instance);
        }
    }

    // Inspection-level facts, so the `from: 'inspection'` arm is exercised too
    // and not only the literal one. Every member of the union gets a key: a
    // missing one reaches the form as `undefined`, which stringifies to a blank
    // box, and a blank box reads as an answer nobody gave.
    const facts = {
        client_name: values.insured_applicant_name ?? null,
        client_email: null,
        client_phone: null,
        property_address: values.address_inspected ?? null,
        property_city: null,
        property_state: null,
        property_zip: null,
        inspection_date: values.date_inspected ?? null,
        inspector_name: values.inspector_signature ?? null,
        inspector_license: values.inspector_license_number ?? null,
        company_name: values.inspector_company_name ?? null,
        company_phone: values.inspector_work_phone ?? null,
        inspector_license_type: null,
        inspector_qualification: null,
        inspector_signature_date: null,
        owner_name: null,
        owner_email: null,
        owner_mailing_address: null,
        owner_home_phone: null,
        owner_work_phone: null,
        owner_cell_phone: null,
        employee_printed_name: null,
    };
    const fromInspection = {
        insured_applicant_name: 'client_name',
        address_inspected: 'property_address',
        date_inspected: 'inspection_date',
        inspector_license_number: 'inspector_license',
        inspector_company_name: 'company_name',
        inspector_work_phone: 'company_phone',
    };

    const bindings = {};
    // A LIST ANSWER CANNOT TRAVEL AS A LITERAL. `literal` carries one string, and
    // the collector stringifies it -- ['copper','other'] becomes "copper,other",
    // which matches no box on any form. That is precisely the narrow pipe
    // multi-select answers were fixed for, and building the check on it would
    // have this harness reproduce the bug while reporting it. So a list is bound
    // the way the product binds one: an item's stored answer, through `asAnswer`.
    const items = [];
    const results = {};
    for (const [ourField, value] of Object.entries(values)) {
        if (grouped.has(ourField)) continue;
        const fact = fromInspection[ourField];
        if (fact !== undefined) {
            bindings[ourField] = { from: 'inspection', field: fact };
            continue;
        }
        if (Array.isArray(value)) {
            const itemId = `itm_${items.length}`;
            items.push({ id: itemId, label: ourField, type: 'multi_select' });
            results[itemId] = { value };
            bindings[ourField] = { from: 'item', itemId };
            continue;
        }
        bindings[ourField] = { from: 'literal', value };
    }

    const declaration = { formId: map.formId, bindings, groups };
    const snapshot = { schemaVersion: 2, sections: [{ id: 'sec', title: 'S', items }] };

    let collected;
    try {
        collected = collectStatutoryValues(declaration, snapshot, results, facts, instances);
    } catch (error) {
        problems.push(`the collector refused a declaration built from this data: `
            + `${error instanceof Error ? error.message : String(error)}`);
        return { ran: true, problems, slots: 0 };
    }

    for (const [ourField, expected] of Object.entries(values)) {
        if (!sameAnswer(collected[ourField], expected)) {
            problems.push(`the collector produced ${JSON.stringify(collected[ourField] ?? null)} `
                + `for "${ourField}" and the render was given ${JSON.stringify(expected)}`);
        }
    }
    const extra = Object.keys(collected).filter((k) => !Object.hasOwn(values, k));
    for (const key of extra) {
        problems.push(`the collector produced "${key}", which the render was never given`);
    }

    // One more instance than the page has columns, for every block the form
    // repeats — refused where nothing can hold it, routed and then FOUND where
    // the form nominates a box.
    const notes = [];
    for (const group of groups) {
        const outcome = await checkPastTheLastSlot({
            group, map, official, values, collected,
            declaration, snapshot, results, facts, instances,
        });
        problems.push(...outcome.problems);
        if (outcome.note !== null) notes.push(outcome.note);
    }

    return { ran: true, problems, slots: grouped.size, notes };
}

/**
 * The answer one overflowing instance gives to every field of its block.
 *
 * It has to be findable in a comments box that already holds the inspector's own
 * prose, and it has to be a string no fixture would produce by accident. The
 * question is whether OUR extra instance reached that box — not whether the box
 * has words in it, which it does before this harness touches anything.
 */
const OVERFLOW_PROBE = 'past-the-last-slot';

/**
 * The sentence the product writes for one overflowing instance, composed HERE.
 *
 * Deliberately NOT imported. `overflowLine` is the code under test, and a check
 * that asks it what it wrote agrees with itself whatever it wrote — the same
 * reason `answerNames` is restated in this file rather than taken from the
 * renderer. So the format is stated independently: the block's printed label,
 * the instance counted from ONE because the reader is counting panels in a
 * house, and each answer as `Field label: value`.
 *
 * If the product's wording moves, this fails and prints both strings. That is
 * the right outcome for wording that lands on an authority's document.
 */
function expectedOverflowLine(group, index) {
    const answered = group.fields.map((field) => {
        const words = field.replace(/_/g, ' ');
        return `${words.charAt(0).toUpperCase()}${words.slice(1)}: ${OVERFLOW_PROBE}`;
    });
    return `${group.label} ${index + 1} — ${answered.join('; ')}.`;
}

/** Whitespace-insensitive containment: a wrapped line is still the same sentence. */
function carries(haystack, needle) {
    const collapse = (s) => s.replace(/\s+/g, ' ').trim();
    return collapse(haystack).includes(collapse(needle));
}

/**
 * What the destination field carries on the page this render actually produced.
 *
 * The overlay case reads the block that STARTS at the mapped coordinate — the
 * runs at that x, at that y and below it, in the order they were drawn — rather
 * than every run on the page. A page-wide search would be satisfied by the
 * sentence landing anywhere at all, including on top of another answer.
 *
 * Returns `text: null` when the destination named a field the produced document
 * does not have, which is a different fact from a box that came out empty.
 */
async function destinationTextOnThePage(official, rendered, mappings) {
    const doc = await PDFDocument.load(rendered);
    const acroform = mappings.find((m) => m.kind === 'acroform');
    if (acroform !== undefined) {
        try {
            const text = doc.getForm().getTextField(acroform.pdfField).getText();
            return { text: text ?? '', where: `the field "${acroform.pdfField}"` };
        } catch {
            return { text: null, where: `the field "${acroform.pdfField}"` };
        }
    }
    const overlay = mappings.find((m) => m.kind === 'overlay');
    if (overlay === undefined) {
        return { text: null, where: 'no text mapping — every mapping for it is a checkbox' };
    }
    const added = await addedRuns(official, rendered, overlay.page + 1);
    const block = (added[overlay.page] ?? [])
        .filter((r) => Math.abs(r.x - overlay.x) <= COORDINATE_TOLERANCE
            && r.y <= overlay.y + COORDINATE_TOLERANCE)
        .sort((a, b) => b.y - a.y);
    return {
        text: block.map((r) => r.text).join(' '),
        where: `(${overlay.x}, ${overlay.y}) on page ${overlay.page}`,
    };
}

/**
 * One block, given one instance more than the form has slots.
 *
 * Every arm returns a `note` for the run's own transcript or `null` where a
 * problem was already recorded: what this checked is printed on a green run too,
 * because a check that only speaks when it fails is indistinguishable from one
 * that never ran.
 */
async function checkPastTheLastSlot(ctx) {
    const {
        group, map, official, values, collected,
        declaration, snapshot, results, facts, instances,
    } = ctx;
    const problems = [];
    const overflowing = {
        ...instances,
        [group.id]: [
            ...(instances[group.id] ?? []),
            Object.fromEntries(group.fields.map((f) => [f, OVERFLOW_PROBE])),
        ],
    };

    let produced = null;
    let refusal = null;
    try {
        produced = collectStatutoryValues(declaration, snapshot, results, facts, overflowing);
    } catch (error) {
        refusal = error instanceof Error ? error.message : String(error);
    }

    const destination = group.overflowTo;
    if (destination === undefined) {
        // Nowhere on this form to put it, so the refusal IS the answer.
        if (refusal === null) {
            problems.push(`${group.capacity + 1} instance(s) of "${group.id}" were ACCEPTED `
                + `against ${group.capacity} slot(s), and the group nominates nowhere for the `
                + 'extra one to go. A dropped instance is an empty slot, and an empty slot reads '
                + 'as an inspector who did not answer.');
            return { problems, note: null };
        }
        for (const fragment of [String(group.capacity + 1), `${group.capacity} slots`, 'narrative report']) {
            if (!refusal.includes(fragment)) {
                problems.push(`the over-capacity refusal for "${group.id}" does not name `
                    + `${JSON.stringify(fragment)}, so it cannot be acted on: ${refusal}`);
            }
        }
        return { problems, note: `"${group.id}" nominates no destination and refused one instance `
            + `too many — ${refusal}` };
    }

    // A destination is declared, so the extra instance is not refused; it is
    // routed. Everything below asks whether it ARRIVED.
    if (refusal !== null) {
        problems.push(`"${group.id}" nominates "${destination}" for an instance past its `
            + `${group.capacity} slot(s), and the collector refused it anyway: ${refusal}`);
        return { problems, note: null };
    }
    const destinationMappings = map.mappings.filter((m) => m.ourField === destination);
    if (destinationMappings.length === 0) {
        problems.push(`"${group.id}" overflows into "${destination}", which this map does not `
            + 'name. Nothing puts that field on the page, so the extra instance is lost exactly '
            + 'as quietly as a dropped one.');
        return { problems, note: null };
    }

    const expectedLine = expectedOverflowLine(group, group.capacity);
    const before = collected[destination];
    const after = produced[destination];
    if (typeof after !== 'string') {
        problems.push(`"${group.id}" overflows into "${destination}" and the collector produced `
            + `${JSON.stringify(after ?? null)} there. One instance was accepted past the last `
            + 'slot and there is no text anywhere holding it.');
        return { problems, note: null };
    }
    if (!after.includes(expectedLine)) {
        problems.push(`"${group.id}" overflows into "${destination}" and the extra instance is `
            + `not in it. Expected that value to carry ${JSON.stringify(expectedLine)}; it reads `
            + `${JSON.stringify(after)}.`);
        return { problems, note: null };
    }
    if (typeof before === 'string' && before !== '' && !after.startsWith(before)) {
        problems.push(`"${group.id}" overflows into "${destination}" and what the inspector had `
            + `already written there did not survive. It read ${JSON.stringify(before)} and now `
            + `reads ${JSON.stringify(after)}.`);
        return { problems, note: null };
    }

    // The value is right. The box still has to print it, and a box measured too
    // small loses the extra instance one step further along than a value check
    // can see.
    let rendered;
    try {
        rendered = await renderStatutoryForm(official, map, { ...values, [destination]: after });
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        problems.push(`"${group.id}" overflows into "${destination}", and the form REFUSED to `
            + `render once the extra instance was in that box: ${message.split('\n')[0]}`);
        return { problems, note: null };
    }
    const landed = await destinationTextOnThePage(official, rendered, destinationMappings);
    if (landed.text === null) {
        problems.push(`"${group.id}" overflows into "${destination}", and the produced document `
            + `has ${landed.where} to read it back from.`);
        return { problems, note: null };
    }
    if (!carries(landed.text, expectedLine)) {
        problems.push(`"${group.id}" overflows into "${destination}", the collector wrote the `
            + 'extra instance into that value, and it is NOT on the produced page. Expected '
            + `${JSON.stringify(expectedLine)} at ${landed.where}; that carries `
            + `${JSON.stringify(landed.text)}.`);
        return { problems, note: null };
    }

    const kept = typeof before === 'string' ? before.length : 0;
    return { problems, note: `"${group.id}" routed one instance past its ${group.capacity} `
        + `slot(s) into "${destination}", after the ${kept} character(s) the inspector had `
        + `already written there, and it was read back off ${landed.where}` };
}

/** Every annotation rectangle on one page of a document, with its field name. */
function widgetRectangles(doc) {
    const perPage = [];
    for (const page of doc.getPages()) {
        const rects = [];
        // `Annots()` and not `get(PDFName.of('Annots'))`: on every one of these
        // forms the entry is an indirect REFERENCE to the array, so the direct
        // read returns a PDFRef, the `instanceof PDFArray` test fails, and the
        // page reports zero annotations. Measured on the TREC form, which has
        // 245 of them: the direct read found 0 on all six pages and reported
        // nothing wrong, which is the exact shape of an empty result passing for
        // a clean one.
        const annots = page.node.Annots();
        if (annots instanceof PDFArray) {
            for (const ref of annots.asArray()) {
                const annot = page.doc.context.lookup(ref);
                const rect = annot?.get?.(PDFName.of('Rect'));
                if (!(rect instanceof PDFArray) || rect.size() !== 4) continue;
                const [x1, y1, x2, y2] = rect.asArray().map((n) => n.asNumber());
                rects.push({
                    x0: Math.min(x1, x2), y0: Math.min(y1, y2),
                    x1: Math.max(x1, x2), y1: Math.max(y1, y2),
                });
            }
        }
        perPage.push(rects);
    }
    return perPage;
}

/** Candidate files this run actually put values through. */
const renderedCandidates = new Set();

/** Candidate file -> the published module generated from it and rendered instead. */
const publishedCandidates = new Map();

const findings = [];
const totals = { formsWithMap: 0, formsExamined: 0, mapped: 0, covered: 0, verified: 0 };
let failed = false;

for (const form of FORMS) {
    line(`── ${form.label} (${form.formId})`);

    const pdfPath = join(pdfDir, form.pdf);
    if (!existsSync(pdfPath)) {
        line(`   ✘ ${form.pdf} is not in STATUTORY_PDF_DIR.`);
        failed = true;
        line();
        continue;
    }
    const official = new Uint8Array(readFileSync(pdfPath));

    if (form.map === null) {
        // The reason is a decision and stays written down. Whether a map EXISTS
        // is a fact about the disk, so it is read off the disk on every run —
        // "no field map for this form exists" is exactly the kind of sentence
        // that is true when it is typed and false the week after, and it would
        // be printed with total confidence either way.
        line(`   NOT COVERED — ${form.notCoveredBecause}.`);
        const candidatePath = join(candidateDir, form.candidate);
        if (existsSync(candidatePath)) {
            const json = JSON.parse(readFileSync(candidatePath, 'utf8'));
            const count = (json.mappings ?? []).length;
            const signed = typeof json.checkedBy === 'string' && json.checkedBy.trim() !== '';
            failed = true;
            line(`   ⚠️ A FIELD MAP FOR THIS FORM NOW EXISTS: candidates/${form.candidate}`);
            line(`      ${count} mapping(s), ${signed ? `signed by ${json.checkedBy}` : 'UNSIGNED'}. `
                + 'Nothing here has ever put a value through it.');
            findings.push(`${form.formId}: a field map has appeared (candidates/${form.candidate}, `
                + `${count} mappings) and this harness has no value set for it, so 0 of its `
                + 'coordinates have ever been rendered. Author one, or say in writing why not.');
        } else {
            line(`   Looked for candidates/${form.candidate}: still not there.`);
        }
        line(`   The PDF is here (${official.length} bytes, sha256 ${sha256Hex(official).slice(0, 16)}…)`);
        line('   and nothing was rendered onto it. 0 field(s) mapped · 0 verified.');
        line();
        continue;
    }
    totals.formsWithMap += 1;

    // ── The map ────────────────────────────────────────────────────────────
    let map;
    let signatureNote;
    /**
     * The repeated blocks, which the PUBLISHED map does not carry.
     *
     * `FieldMap` has no `groups`: a repeated block is part of the template
     * DECLARATION, not of the map from our fields onto the page. The collector
     * check below is the only place `electrical_panel[0]` and `[1]` can be
     * caught being written into each other's column, so the blocks are read
     * from the candidate the module was generated from rather than lost the day
     * a form moved from candidate-rendering to module-rendering — which would
     * have silently turned that check off for the two forms that have any.
     */
    let groups = [];
    if (form.map.kind === 'published') {
        map = form.map.value;
        publishedCandidates.set(form.candidate, form.map.module);
        signatureNote = `signed by ${map.checkedBy} on ${new Date(map.checkedAt).toISOString().slice(0, 10)}`;
        line(`   map: ${form.map.module} (published)`);
        const candidatePath = join(candidateDir, form.candidate);
        if (existsSync(candidatePath)) {
            groups = JSON.parse(readFileSync(candidatePath, 'utf8')).groups ?? [];
        }
    } else {
        const candidatePath = join(candidateDir, form.map.file);
        if (!existsSync(candidatePath)) {
            line(`   ✘ candidates/${form.map.file} is not beside the PDFs.`);
            failed = true;
            line();
            continue;
        }
        const candidateBytes = readFileSync(candidatePath);
        const loaded = candidateToFieldMap(JSON.parse(candidateBytes.toString('utf8')));
        map = loaded.map;
        groups = map.groups ?? [];
        renderedCandidates.add(form.map.file);
        // The candidate's OWN hash, beside the PDF's. These files are authored
        // by hand and revised while work is in flight — one of them was
        // rewritten between two runs of this harness on 2026-08-29 — so a report
        // of what passed has to name the bytes that passed.
        line(`   map: candidates/${form.map.file} · sha256 `
            + `${sha256Hex(candidateBytes).slice(0, 16)}…`);
        if (loaded.signed) {
            signatureNote = `signed by ${loaded.checkedBy} on ${loaded.checkedAt}`;
        } else {
            signatureNote = 'UNSIGNED';
            failed = true;
            findings.push(`${form.formId}: the candidate map carries no checkedBy/checkedAt. `
                + 'It is refused, and cannot be published, until a person signs it.');
            line('   ⚠️ UNSIGNED — the candidate names nobody and no date, so the real');
            line('      validator refuses it before any geometric rule runs. A sentinel');
            line(`      signature (${UNSIGNED_SENTINEL}) is substituted BELOW THIS LINE ONLY,`);
            line('      so that one missing signature does not hide every mis-measured');
            line('      coordinate behind it. This form is reported as FAILED regardless.');
        }
    }
    line(`   signature: ${signatureNote}`);

    const actualHash = sha256Hex(official);
    line(`   pdf: ${form.pdf} · ${official.length} bytes · sha256 ${actualHash.slice(0, 16)}…`
        + (actualHash === map.sourceHash ? ' (matches the map)' : ' ⚠️ DOES NOT MATCH THE MAP'));

    // ── The data ───────────────────────────────────────────────────────────
    const valuesPath = join(ROOT, form.values);
    if (!existsSync(valuesPath)) {
        line(`   ✘ no test data at ${form.values}. A form with no data verifies nothing.`);
        failed = true;
        line();
        continue;
    }
    const values = JSON.parse(readFileSync(valuesPath, 'utf8')).values ?? {};

    const namedFields = [...new Set(map.mappings.map((m) => m.ourField))];
    const coveredFields = namedFields.filter((f) => Object.hasOwn(values, f));
    const uncovered = namedFields.filter((f) => !Object.hasOwn(values, f));
    const strayValues = Object.keys(values).filter((k) => !namedFields.includes(k));
    totals.mapped += namedFields.length;
    totals.covered += coveredFields.length;

    for (const f of uncovered) {
        findings.push(`${form.formId}: the map names "${f}" and the test data has no value for it. `
            + 'A field never given a value is a coordinate this run did not exercise.');
    }
    for (const k of strayValues) {
        findings.push(`${form.formId}: the test data carries "${k}", which this map does not name. `
            + 'The renderer refuses a value with no mapping, so this stops the whole form.');
    }
    if (uncovered.length || strayValues.length) failed = true;

    // ── The names, looked up independently of the code under test ──────────
    const originalDoc = await PDFDocument.load(official);
    const officialNames = new Set(originalDoc.getForm().getFields().map((f) => f.getName()));
    const acroformMappings = map.mappings.filter(
        (m) => m.kind === 'acroform' || m.kind === 'acroform_checkbox',
    );
    const unresolved = acroformMappings.filter((m) => !officialNames.has(m.pdfField));
    if (unresolved.length) {
        failed = true;
        for (const m of unresolved) {
            findings.push(`${form.formId}: "${m.ourField}" maps to the field "${m.pdfField}", `
                + 'which this PDF does not have. A name that does not resolve sets nothing '
                + 'and raises nothing.');
        }
    }
    if (acroformMappings.length) {
        line(`   acroform: ${acroformMappings.length} mapping(s) · `
            + `${acroformMappings.length - unresolved.length} resolve against the ${officialNames.size} `
            + `field(s) this PDF actually has · ${unresolved.length} do not`);
    }

    // ── The value collector, where the map declares repeated blocks ────────
    const collector = await checkTheValueCollector({ ...map, groups }, values, official);
    if (!collector.ran) {
        line('   collector: this form declares no repeated blocks, so there is nothing');
        line('      positional to get wrong before the render.');
    } else if (collector.problems.length === 0) {
        line(`   collector: the real collector reproduced all ${namedFields.length} value(s) from a `
            + `declaration with ${groups.length} repeated block(s), ${collector.slots} of them`);
        line('      positional slots. Past the last slot:');
        for (const note of collector.notes) line(`      · ${note}`);
    } else {
        failed = true;
        line(`   ✘ ${collector.problems.length} problem(s) on the way IN, before the renderer:`);
        for (const problem of collector.problems) line(`      ${problem}`);
        for (const problem of collector.problems) findings.push(`${form.formId}: ${problem}`);
    }

    // ── The render ─────────────────────────────────────────────────────────
    let rendered;
    try {
        rendered = await renderStatutoryForm(official, map, values);
    } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : String(error);
        line('   ✘ THE RENDER REFUSED:');
        for (const part of message.split('\n')) line(`      ${part}`);
        line(`   ${namedFields.length} field(s) mapped · ${coveredFields.length} covered by the `
            + 'test data · 0 verified present on the page.');
        findings.push(`${form.formId}: the render refused — ${message.split('\n')[0]}`);
        line();
        continue;
    }
    totals.formsExamined += 1;

    if (outDir !== null) {
        const target = join(isAbsolute(outDir) ? outDir : resolve(process.cwd(), outDir),
            `${form.formId}.rendered.pdf`);
        writeFileSync(target, rendered);
        line(`   wrote ${target} — hold it beside the original. Nothing here can tell you`);
        line('      whether a coordinate names the RIGHT blank; only that page can.');
    }

    // ── Reading the values back off the page ───────────────────────────────
    const renderedDoc = await PDFDocument.load(rendered);
    const renderedForm = renderedDoc.getForm();
    const pageCount = renderedDoc.getPageCount();
    const added = await addedRuns(official, rendered, pageCount);
    const rects = widgetRectangles(originalDoc);
    const ruler = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);

    const verifiedFields = new Set();
    let expectedWrites = 0;
    let verifiedWrites = 0;
    let absenceChecks = 0;
    const overruns = [];
    const clipped = [];
    const unmeasuredWraps = [];
    const underWidgets = [];
    const strayMarks = [];
    let unbounded = 0;

    for (const mapping of map.mappings) {
        const value = values[mapping.ourField];
        if (value === undefined) continue;

        if (mapping.kind === 'acroform') {
            expectedWrites += 1;
            let readBack;
            let field = null;
            try {
                field = renderedForm.getTextField(mapping.pdfField);
                readBack = field.getText();
            } catch {
                readBack = undefined;
            }
            if (field !== null) {
                for (const problem of clippedLinesInAppearance(renderedDoc, field, ruler)) {
                    clipped.push(`${mapping.ourField} -> "${mapping.pdfField}": ${problem}`);
                }
            }
            if (readBack === value) {
                verifiedWrites += 1;
                verifiedFields.add(mapping.ourField);
            } else {
                findings.push(`${form.formId}: "${mapping.ourField}" was set to `
                    + `${JSON.stringify(value)} and the saved document reads back `
                    + `${JSON.stringify(readBack ?? null)} from "${mapping.pdfField}".`);
            }
            continue;
        }

        if (mapping.kind === 'acroform_checkbox') {
            let ticked = null;
            try {
                ticked = renderedForm.getCheckBox(mapping.pdfField).isChecked();
            } catch {
                ticked = null;
            }
            if (!answerNames(value, mapping.whenValue)) {
                // The widget this answer did NOT choose. Asserted for the same
                // reason the drawn ones are: a renderer that ticked all four
                // boxes of a four-way rating satisfies every "it is ticked".
                absenceChecks += 1;
                if (ticked === true) {
                    strayMarks.push(`${mapping.ourField} = "${mapping.whenValue}" `
                        + `(the answer given was ${JSON.stringify(value)})`);
                }
                continue;
            }
            expectedWrites += 1;
            if (ticked === true) {
                verifiedWrites += 1;
                verifiedFields.add(mapping.ourField);
            } else {
                findings.push(`${form.formId}: "${mapping.ourField}" answered `
                    + `"${mapping.whenValue}" and the widget "${mapping.pdfField}" reads back `
                    + `${ticked === null ? 'as no checkbox at all' : 'unticked'} in the saved `
                    + 'document.');
            }
            continue;
        }

        if (mapping.kind === 'checkbox') {
            if (!answerNames(value, mapping.whenValue)) {
                // The box this answer did NOT choose. A renderer that marks all
                // four boxes of a four-way rating satisfies every "the mark is
                // present" assertion ever written, so absence is asserted too.
                // Counted, and the count printed, because a check that never
                // reports anything is indistinguishable from one that never ran.
                absenceChecks += 1;
                if (runsAt(added, mapping.page, mapping.x, mapping.y).some((r) => r.text === MARK)) {
                    strayMarks.push(`${mapping.ourField} = "${mapping.whenValue}" `
                        + `(the answer given was ${JSON.stringify(value)})`);
                }
                continue;
            }
            expectedWrites += 1;
            const marks = runsAt(added, mapping.page, mapping.x, mapping.y);
            if (marks.some((r) => r.text === MARK)) {
                verifiedWrites += 1;
                verifiedFields.add(mapping.ourField);
                const box = (rects[mapping.page] ?? []).find(
                    (r) => mapping.x >= r.x0 && mapping.x <= r.x1 && mapping.y >= r.y0 && mapping.y <= r.y1,
                );
                if (box !== undefined) {
                    underWidgets.push(`${mapping.ourField} = "${mapping.whenValue}" at `
                        + `(${mapping.x}, ${mapping.y}) on page ${mapping.page}`);
                }
            } else {
                findings.push(`${form.formId}: "${mapping.ourField}" answered `
                    + `"${mapping.whenValue}" drew no mark at (${mapping.x}, ${mapping.y}) `
                    + `on page ${mapping.page}.`);
            }
            continue;
        }

        // overlay
        if (value === '') continue;
        expectedWrites += 1;
        const expected = mapping.part === undefined
            ? value
            : partOfValue(value, mapping.part, mapping.ourField);
        const runs = runsAt(added, mapping.page, mapping.x, mapping.y);
        const found = runs.map((r) => r.text).join(' ');
        const match = runs.length === 0 ? null : textMatches(found, expected);
        if (match !== null) {
            verifiedWrites += 1;
            verifiedFields.add(mapping.ourField);
        } else {
            findings.push(`${form.formId}: "${mapping.ourField}"`
                + `${mapping.part === undefined ? '' : ` (${mapping.part})`} should read `
                + `${JSON.stringify(expected)} at (${mapping.x}, ${mapping.y}) on page `
                + `${mapping.page}; the page carries ${JSON.stringify(found)} there.`);
        }

        // Overflow that `fit.ts` could not see. It measures nothing at all
        // unless the map declares BOTH bounds, so a row with a width and no
        // height — or with neither — is drawn against nothing.
        //
        // The wrap is the half nobody can adjudicate from here. pdf-lib breaks
        // at spaces, so a value too long for its blank does not overrun to the
        // right; it steps DOWN, over the row beneath it, and every width
        // measurement still passes. Whether that is right depends on whether the
        // blank is one printed line or a comments box — which is exactly what a
        // missing maxHeight fails to say.
        if (mapping.maxHeight === undefined && runs.length > 1) {
            unmeasuredWraps.push(`${mapping.ourField}: ${JSON.stringify(expected)} wrapped onto `
                + `${runs.length} line(s) at (${mapping.x}, ${mapping.y}) on page ${mapping.page}`);
        }
        if (mapping.maxWidth === undefined) {
            unbounded += 1;
            continue;
        }
        for (const run of runs) {
            const width = ruler.widthOfTextAtSize(run.text, run.size);
            if (width > mapping.maxWidth + 0.5) {
                overruns.push(`${mapping.ourField}`
                    + `${mapping.part === undefined ? '' : ` (${mapping.part})`}: `
                    + `${JSON.stringify(run.text)} is ${width.toFixed(2)}pt at size ${run.size} `
                    + `in a blank measured ${mapping.maxWidth}pt`
                    + `${mapping.maxHeight === undefined ? ' (no maxHeight, so nothing measured it)' : ''}`);
            }
        }
    }

    totals.verified += verifiedFields.size;

    if (strayMarks.length) {
        failed = true;
        line(`   ✘ ${strayMarks.length} mark(s) in a box the answer did not choose:`);
        for (const s of strayMarks) line(`      ${s}`);
        findings.push(`${form.formId}: ${strayMarks.length} box(es) marked for an answer nobody gave.`);
    }
    if (clipped.length) {
        failed = true;
        line(`   ✘ ${clipped.length} line(s) fall outside the box of the field they were put in.`);
        line('      Every one of these passed refuseIfTheWidgetWouldClip on the way in: the');
        line('      field reads back correctly and the printed document is missing the text.');
        for (const c of clipped) line(`      ${c}`);
        findings.push(`${form.formId}: ${clipped.length} line(s) are clipped by the field box `
            + 'they were written into, after the clipping check passed them.');
    }
    if (overruns.length) {
        failed = true;
        line(`   ✘ ${overruns.length} value(s) ran past the blank measured for them:`);
        for (const o of overruns) line(`      ${o}`);
        findings.push(`${form.formId}: ${overruns.length} overlay(s) overran their measured blank.`);
    }
    if (unmeasuredWraps.length) {
        // ⚠️ Reported, never a failure. A comments box is SUPPOSED to wrap, and
        // a map that declares no maxHeight is the reason nothing here can tell
        // that box from a single printed line whose answer just ran over it.
        // Failing on this would push somebody to shorten the data until the
        // harness went quiet, which would hide the map's missing measurement
        // rather than record it.
        line(`   ⚠️ ${unmeasuredWraps.length} value(s) wrapped onto a second line in a row whose`);
        line('      height nobody measured. Where that row is one printed line, the extra');
        line('      lines are written over the row beneath it and nothing raises:');
        for (const wrapped of unmeasuredWraps) line(`      ${wrapped}`);
    }
    if (underWidgets.length) {
        // Reported on every run, and NOT a failure by itself: whether a widget's
        // own appearance paints over the mark depends on that widget's off-state
        // stream, which this cannot settle. What it can say is that the mark is
        // inside an annotation rectangle, and annotations are painted after page
        // content.
        line(`   ⚠️ ${underWidgets.length} mark(s) drawn INSIDE an existing widget rectangle.`);
        line('      This form has real checkbox widgets and the map draws text over them.');
        line('      Annotations paint after page content, so the widget\'s own off-state');
        line('      appearance may cover the mark; and the document\'s field data says');
        line('      those boxes are unticked whatever is drawn on top. First three:');
        for (const u of underWidgets.slice(0, 3)) line(`      ${u}`);
    }
    if (unbounded) {
        line(`   ⚠️ ${unbounded} overlay(s) declare no maxWidth, so nothing measured whether`);
        line('      their text stayed inside the blank — not here, and not in fit.ts.');
    }

    line(`   ${namedFields.length} field(s) mapped · ${coveredFields.length} covered by the test `
        + `data · ${verifiedFields.size} verified present on the page`);
    line(`   ${map.mappings.length} mapping(s) · ${expectedWrites} expected to write with this `
        + `data · ${verifiedWrites} verified · ${absenceChecks} box(es) checked for the mark they `
        + 'must NOT carry');
    if (verifiedWrites < expectedWrites) failed = true;
    if (expectedWrites === 0) {
        failed = true;
        findings.push(`${form.formId}: nothing was expected to be written. A form that wrote `
            + 'nothing verifies nothing.');
    }
    line();
}

// ── Every candidate on disk, whether this harness knows about it or not ──
// The FORMS table above is a list somebody typed. The candidates directory is
// what is actually there. A map authored after this file was last edited is
// invisible to the table and completely visible here, and "the forms we cover"
// silently meaning "the forms we covered in August" is the failure this repo has
// watched most often.
const onDisk = readdirSync(candidateDir).filter((f) => f.endsWith('.candidate.json'));
const viaModule = onDisk.filter((f) => publishedCandidates.has(f));
const uncovered = onDisk.filter((f) => !renderedCandidates.has(f) && !publishedCandidates.has(f));
line('── Candidate maps on disk');
line(`   ${onDisk.length} candidate map(s) beside the PDFs · ${renderedCandidates.size} rendered `
    + `from the candidate · ${viaModule.length} rendered through the published module generated `
    + `from it · ${uncovered.length} never rendered at all`);
for (const file of viaModule) {
    line(`   candidates/${file} — rendered as ${publishedCandidates.get(file)}`);
}
for (const file of uncovered) {
    line(`   ⚠️ candidates/${file} — nothing here has ever put a value through it`);
}
line();

// ── The tally. Printed whether the run is green or red ─────────────────────
line('── Totals');
line(`   ${FORMS.length} form(s) in the table · ${totals.formsWithMap} this harness renders · `
    + `${FORMS.length - totals.formsWithMap} listed and deliberately not rendered`);
line(`   ${totals.formsExamined} form(s) actually rendered and read back`);
line(`   ${totals.mapped} field(s) mapped · ${totals.covered} covered by test data · `
    + `${totals.verified} verified present on the page`);
line();

if (findings.length) {
    line(`${findings.length} finding(s):`);
    for (const f of findings) line(`  ✘ ${f}`);
    line();
}

// Zero here is a failure, not a clean sweep. An empty run satisfies "nothing was
// wrong" vacuously, and this repository has watched exactly that read as green.
if (totals.formsExamined === 0) {
    line('✘ Not one form was rendered. A run over nothing is not a verification.');
    process.exit(1);
}
if (totals.verified === 0) {
    line('✘ Not one field was verified present on a page. Nothing here was measured.');
    process.exit(1);
}
if (failed) {
    line('✘ Statutory-render gate — a value that did not reach the page is a blank on an');
    line('  official document, and a blank looks exactly like an answer nobody had.');
    process.exit(1);
}

line(`✅ Statutory-render gate — ${totals.verified} of ${totals.mapped} mapped field(s) confirmed `
    + `on the authorities' own pages across ${totals.formsExamined} form(s).`);
process.exit(0);
