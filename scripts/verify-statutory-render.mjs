#!/usr/bin/env node
/**
 * Produce ONE real statutory form and check where the values landed.
 *
 * ## Why a script and not a unit test
 *
 * The repeatable-group helpers had nine passing unit tests and no caller. Those
 * tests proved the functions worked; they could not prove the FEATURE worked,
 * because nothing expanded a group onto an actual page. The gap between the two
 * is exactly where positional addressing fails: `electrical_panel[0]` and
 * `electrical_panel[1]` are two columns on one row of the Citizens four-point
 * form, and a form with the main panel's amperage printed in the second panel's
 * column looks completely normal. It prints. It is the right length. Every
 * assertion about its own values passes.
 *
 * So this walks the real path — collect values from a declaration that declares
 * groups, render onto the authority's published bytes — and then hands the
 * result to a reader that measures WHERE each value ended up. "A PDF came out
 * and its byte length is greater than zero" is not a check: a form with the two
 * panels written into each other's columns also has a byte length greater than
 * zero.
 *
 * ## What this script does NOT bring with it
 *
 * Neither input is in this repository, and both are arguments for that reason:
 *
 *   --map  an authored field map for one revision. A map is a person's
 *          measurement of one revision's page, not something code can derive.
 *   --pdf  the authority's own published bytes. Their document, not ours; the
 *          renderer's whole point is that the output IS their file, so a copy
 *          vendored here would be a copy that can go stale against the source.
 *
 * The map's `sourceHash` is checked against those bytes before anything is
 * written, so the pair cannot silently drift apart.
 *
 * ## Reading the output
 *
 * It writes the produced PDF and a `slots.json` naming each repeated slot's own
 * coordinate and the value that belongs there. The coordinate comes from the
 * map rather than from this file, so the reader that checks placement is
 * measuring against the same measurement the renderer drew from.
 *
 *   node scripts/verify-statutory-render.mjs --map <candidate.json> --pdf <form.pdf> [--out <dir>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'esbuild';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function arg(name) {
    const at = process.argv.indexOf(`--${name}`);
    return at === -1 ? undefined : process.argv[at + 1];
}

function usage(reason) {
    console.error(`verify-statutory-render: ${reason}`);
    console.error('  --map <candidate.json>  the authored field map for one revision');
    console.error('  --pdf <form.pdf>        the published bytes for that same revision');
    console.error('  --out <dir>             where to write the produced form (default: a temp dir)');
    process.exit(1);
}

const mapPath = arg('map');
const pdfPath = arg('pdf');
const outDir = arg('out') ?? join(tmpdir(), 'statutory-render-verify');
if (!mapPath) usage('no --map given');
if (!pdfPath) usage('no --pdf given');

/**
 * Load the two server modules through a bundle.
 *
 * They are TypeScript with extensionless imports, which node resolves for
 * neither reason. Bundling with the esbuild already in this tree keeps the
 * script a plain `node` invocation, and — the part that matters — makes it the
 * REAL modules that run rather than a transcription of them.
 */
async function loadStatutoryModules() {
    await mkdir(outDir, { recursive: true });
    const outfile = join(outDir, '_statutory-bundle.mjs');
    await build({
        stdin: {
            contents: [
                "export { collectStatutoryValues } from './server/lib/statutory/values';",
                "export { renderStatutoryForm } from './server/lib/statutory/render';",
            ].join('\n'),
            resolveDir: ROOT,
            loader: 'ts',
        },
        bundle: true,
        format: 'esm',
        platform: 'node',
        target: 'node22',
        outfile,
        logLevel: 'warning',
    });
    return import(pathToFileURL(outfile).href);
}

/** Inspection-level answers, one per closed field name. */
const FACTS = {
    client_name: 'Zoe Ng',
    client_email: null,
    client_phone: null,
    property_address: '1 Main St, Miami FL 33101',
    property_city: 'Miami',
    property_state: 'FL',
    property_zip: '33101',
    inspection_date: '2026-08-28',
    inspector_name: 'Sam Reed',
    inspector_license: 'HI-12345',
    company_name: 'Reed Home Inspections',
    company_phone: '305-555-0142',
};

/**
 * What the inspection recorded for each repeated block.
 *
 * THE TWO PANELS CARRY DIFFERENT AMPERAGES ON PURPOSE. Equal values would pass
 * just as well for a renderer that wrote slot 0 into both columns, or that
 * swapped the two.
 */
const INSTANCES = {
    electrical_panel: [
        { type: 'Circuit breaker', total_amps: '100', amperage_sufficient: 'Yes' },
        { type: 'Circuit breaker', total_amps: '200', amperage_sufficient: 'Yes' },
    ],
    roof: [
        {
            covering_material: 'Shingle',
            roof_age_years: '8',
            remaining_useful_life_years: '12',
            overall_condition: 'Satisfactory',
        },
        {},
    ],
};

/** The non-repeating half of the form: enough to satisfy every required field. */
const BINDINGS = {
    insured_applicant_name: { from: 'inspection', field: 'client_name' },
    address_inspected: { from: 'inspection', field: 'property_address' },
    actual_year_built: { from: 'literal', value: '1998' },
    date_inspected: { from: 'inspection', field: 'inspection_date' },
    'electrical.general_condition': { from: 'literal', value: 'Satisfactory' },
    'hvac.central_ac': { from: 'literal', value: 'Yes' },
    'hvac.central_heat': { from: 'literal', value: 'Yes' },
    'hvac.systems_in_good_working_order': { from: 'literal', value: 'Yes' },
    'plumbing.tprv_on_water_heater': { from: 'literal', value: 'Yes' },
    'plumbing.active_leak': { from: 'literal', value: 'No' },
    'plumbing.prior_leak': { from: 'literal', value: 'No' },
    // This revision prints a signature LINE and this candidate maps it as an
    // overlay, so a name goes on it. Drawing a stored signature image is a
    // separate mapping kind that the renderer still refuses outright.
    inspector_signature: { from: 'literal', value: 'Sam Reed' },
    inspector_license_number: { from: 'inspection', field: 'inspector_license' },
    inspector_license_type: { from: 'literal', value: 'Home Inspector' },
    inspector_company_name: { from: 'inspection', field: 'company_name' },
    inspection_date: { from: 'inspection', field: 'inspection_date' },
};

function assert(condition, message) {
    if (!condition) {
        console.error(`verify-statutory-render: ${message}`);
        process.exit(1);
    }
}

async function main() {
    const { collectStatutoryValues, renderStatutoryForm } = await loadStatutoryModules();

    const candidate = JSON.parse(await readFile(mapPath, 'utf8'));
    const officialPdf = new Uint8Array(await readFile(pdfPath));
    const hash = createHash('sha256').update(officialPdf).digest('hex');
    assert(hash === candidate.sourceHash,
        `these bytes hash to ${hash} and the map was authored against ${candidate.sourceHash}`);

    // A CANDIDATE map has not been signed by a person yet — that signature is a
    // step code cannot take. The renderer refuses a map with no `checkedBy`, so
    // this script supplies its own name rather than borrowing somebody's: what
    // comes out is a verification artefact, never a filing.
    const map = {
        ...candidate,
        checkedBy: candidate.checkedBy ?? 'UNCHECKED CANDIDATE (scripts/verify-statutory-render.mjs)',
        checkedAt: candidate.checkedAt ?? Date.now(),
    };
    assert(Array.isArray(map.groups) && map.groups.length > 0,
        'this map declares no groups, so it cannot demonstrate the thing being verified');

    const declaration = { formId: map.formId, bindings: BINDINGS, groups: map.groups };

    // -- 1. the real collector, with groups ---------------------------------
    const values = collectStatutoryValues(
        declaration, { schemaVersion: 2, sections: [] }, {}, FACTS, INSTANCES,
    );
    for (const [name, expected] of [
        ['electrical_panel[0].total_amps', '100'],
        ['electrical_panel[1].total_amps', '200'],
    ]) {
        assert(values[name] === expected,
            `collected "${name}" as ${JSON.stringify(values[name])}, `
            + `expected ${JSON.stringify(expected)}`);
    }
    const fromGroups = map.groups.reduce((n, g) => n + g.capacity * g.fields.length, 0);
    console.log(`collected  ${Object.keys(values).length} values, ${fromGroups} of them from groups`);

    // -- 2. the real renderer, onto the authority's own bytes ---------------
    const produced = await renderStatutoryForm(officialPdf, map, values);
    const pdfOut = join(outDir, `${map.formId}.verify.pdf`);
    await writeFile(pdfOut, produced);

    // -- 3. hand the reader each slot's OWN coordinate ----------------------
    // Taken from the map, not retyped here: the placement check then measures
    // against the same measurement the renderer drew from.
    const slots = [];
    for (const group of map.groups) {
        for (let index = 0; index < group.capacity; index++) {
            for (const field of group.fields) {
                const ourField = `${group.id}[${index}].${field}`;
                const expected = values[ourField];
                if (expected === undefined || expected === '') continue;
                const mapping = map.mappings.find(
                    (m) => m.ourField === ourField && m.kind === 'overlay');
                if (!mapping) continue;
                slots.push({
                    group: group.id,
                    slotLabel: group.slotLabels[index],
                    ourField,
                    expected,
                    page: mapping.page,
                    x: mapping.x,
                    y: mapping.y,
                    size: mapping.size,
                });
            }
        }
    }
    const slotsOut = join(outDir, 'slots.json');
    await writeFile(slotsOut, `${JSON.stringify({ pdf: pdfOut, slots }, null, 2)}\n`);

    // -- 4. the refusal this whole design exists for, on the real path ------
    // A house with three panels against a form with two. Until this ran through
    // `collectStatutoryValues`, the refusal could not happen to anybody.
    const overflowing = {
        ...INSTANCES,
        electrical_panel: [...INSTANCES.electrical_panel, { total_amps: '300' }],
    };
    let refusal = null;
    try {
        collectStatutoryValues(
            declaration, { schemaVersion: 2, sections: [] }, {}, FACTS, overflowing,
        );
    } catch (err) {
        refusal = err instanceof Error ? err.message : String(err);
    }
    assert(refusal !== null, 'three instances against a capacity of two were ACCEPTED');
    for (const fragment of ['3', '2 slots', 'narrative report']) {
        assert(refusal.includes(fragment),
            `the refusal does not name ${JSON.stringify(fragment)}: ${refusal}`);
    }

    console.log(`produced   ${pdfOut} (${produced.byteLength} bytes)`);
    console.log(`slots      ${slotsOut} (${slots.length} filled slot(s))`);
    console.log(`refusal    ${refusal}`);
    console.log('NOTE: a byte length is not a verification. Check placement against slots.json.');
}

await main();
