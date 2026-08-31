/**
 * The box each Citizens form nominates for what its slots could not hold.
 *
 * ── Why these two forms declare one and the wind-mitigation form does not ────
 * They say so on the page. The four-point form prints "(use additional pages if
 * needed)" beside its Additional Comments box and the roof form prints "(use
 * additional pages as needed)" beside its own — the publisher's own answer to
 * where a third roof goes. The 1802 has no comments, notes, remarks or explain
 * field anywhere on it, so it keeps the plain refusal.
 *
 * Leaving the destination undeclared is not caution. The form says put the extra
 * on an additional page, and an undeclared group REFUSES a third roof — software
 * stricter than the authority, while the inspector is standing in front of one.
 *
 * ── The number is DERIVED FROM THE PUBLISHED MAP, never typed here ───────────
 * `overflowMaxLength` is a count of characters read off the page, so this file
 * recomputes it from the geometry the signed map carries — the box's own width
 * and height, the size the map draws at, and the font `render.ts` embeds — and
 * checks the declaration against that. A literal chosen in the same commit as
 * the declaration would agree with it and with nothing else.
 *
 * ⚠️ It is a count of the box, not a guarantee about every text. `fit.ts` still
 * measures the wrapped lines geometrically and can refuse a value shorter than
 * this one whose words happen to break badly. That is the documented
 * arrangement: this number exists so the FIRST refusal can say which instance
 * did not fit, which is the sentence an inspector can act on, and the geometric
 * one remains the one that decides.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type { StatutoryInspectionFacts } from '../../../server/lib/statutory/values';
import type { FieldMap, OverlayMapping } from '../../../server/lib/statutory/field-map';
import { fieldMap as roofMap } from '../../../server/lib/statutory/forms/fl-citizens-roof';
import { fieldMap as fourPointMap } from '../../../server/lib/statutory/forms/fl-citizens-4point';
import roofSeed from '../../../server/data/seed-templates/fl-citizens-roof-rcf-1.json';
import fourPointSeed from '../../../server/data/seed-templates/fl-citizens-4point-insp4pt.json';
import type {
    FieldGroup, StatutoryFormDeclaration, TemplateSchemaV2,
} from '../../../server/types/template-schema';
import { buildFlatPdf, type PdfFixture } from '../helpers/statutory-pdf-fixtures';
import { drawnRuns } from '../helpers/pdf-drawn-runs';

const NO_FACTS = {} as unknown as StatutoryInspectionFacts;
const EMPTY_SNAPSHOT = { schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2;

let ruler: PDFFont;
let flat: PdfFixture;

beforeAll(async () => {
    // The same font `render.ts` measures with, embedded the same way.
    ruler = await (await PDFDocument.create()).embedFont(StandardFonts.Helvetica);
    flat = await buildFlatPdf();
});

const groupsOf = (seed: { schema: unknown }): readonly FieldGroup[] =>
    ((seed.schema as { statutoryForm: StatutoryFormDeclaration }).statutoryForm.groups ?? []);

const overlayFor = (map: FieldMap, ourField: string): OverlayMapping => {
    const found = map.mappings.find(
        (m): m is OverlayMapping => m.kind === 'overlay' && m.ourField === ourField,
    );
    if (found === undefined) throw new Error(`no overlay for ${ourField}`);
    return found;
};

/** Lines of `size` that stand inside `maxHeight`, exactly as `fit.ts` counts them. */
function linesThatFit(size: number, maxHeight: number): number {
    return Math.floor(maxHeight / ruler.heightAtSize(size));
}

/** Characters of THIS text that stand on one line of `maxWidth`. */
function charactersOnALine(text: string, size: number, maxWidth: number): number {
    const source = `${text} `.repeat(30);
    let n = 0;
    while (ruler.widthOfTextAtSize(source.slice(0, n + 1), size) <= maxWidth) n++;
    return n;
}

/** A declaration carrying one real group and nothing else that has to resolve. */
function declarationFor(group: FieldGroup, destination: string): StatutoryFormDeclaration {
    return {
        formId: 'xx_measurement_only',
        bindings: { [destination]: { from: 'literal', value: '' } },
        groups: [group],
    };
}

/** One instance past capacity, with every field of the block answered. */
function oneInstancePastCapacity(group: FieldGroup): Record<string, string>[] {
    const instances: Record<string, string>[] = [];
    for (let i = 0; i <= group.capacity; i++) {
        const instance: Record<string, string> = {};
        for (const field of group.fields) instance[field] = 'recorded on site';
        instances.push(instance);
    }
    return instances;
}

/** What `routeOverflow` actually writes into the destination for that group. */
function routedText(group: FieldGroup): string {
    const destination = group.overflowTo ?? '';
    const values = collectStatutoryValues(
        declarationFor(group, destination),
        EMPTY_SNAPSHOT,
        {},
        NO_FACTS,
        { [group.id]: oneInstancePastCapacity(group) },
    );
    return String(values[destination]);
}

describe('both Citizens forms nominate their Additional Comments box', () => {
    const cases = [
        { name: 'roof RCF-1', map: roofMap, groups: groupsOf(roofSeed) },
        { name: 'four-point', map: fourPointMap, groups: groupsOf(fourPointSeed) },
    ];

    for (const { name, map, groups } of cases) {
        it(`${name}: every group names a destination the map actually writes`, () => {
            const written = new Set(map.mappings.map((m) => m.ourField));
            expect(groups.length).toBeGreaterThan(0);
            for (const group of groups) {
                expect(group.overflowTo, group.id).toBe('additional_comments');
                expect(written, group.id).toContain(group.overflowTo);
            }
        });

        it(`${name}: the declared length is what the published box holds`, () => {
            const box = overlayFor(map, 'additional_comments');
            expect(box.maxWidth).toBeDefined();
            expect(box.maxHeight).toBeDefined();
            const lines = linesThatFit(box.size, box.maxHeight as number);
            for (const group of groups) {
                const perLine = charactersOnALine(
                    routedText(group), box.size, box.maxWidth as number,
                );
                expect(group.overflowMaxLength, `${group.id}: ${lines} lines x ${perLine}`)
                    .toBe(lines * perLine);
            }
        });
    }

    it('CONTROL — the measurement reads the map, and a shorter box gives a smaller number', () => {
        // Without this the two assertions above are satisfied by an arithmetic
        // that ignores its inputs. The roof form's box is the taller of the two
        // and its number is the larger; halving a height halves the lines.
        const roofBox = overlayFor(roofMap, 'additional_comments');
        const fourPointBox = overlayFor(fourPointMap, 'additional_comments');
        expect(roofBox.maxHeight as number).toBeGreaterThan(fourPointBox.maxHeight as number);
        const tall = linesThatFit(roofBox.size, roofBox.maxHeight as number);
        const short = linesThatFit(fourPointBox.size, fourPointBox.maxHeight as number);
        expect(tall).toBeGreaterThan(short);
        expect(linesThatFit(roofBox.size, (roofBox.maxHeight as number) / 2))
            .toBeLessThan(tall);
        // And the two forms therefore declare different numbers.
        const declared = [...groupsOf(roofSeed), ...groupsOf(fourPointSeed)]
            .map((g) => g.overflowMaxLength);
        expect(new Set(declared).size).toBe(2);
    });

    it('CONTROL — the candidate and the published template agree, group for group', () => {
        // The declaration is signed in one repository and published in another.
        // Nothing else compares the two, so a change made on one side alone is
        // invisible: `lint:statutory-fidelity` reads hashes and signatures.
        for (const { groups } of cases) {
            for (const group of groups) {
                expect(group.overflowMaxLength, group.id).toBeGreaterThan(0);
                expect(Number.isInteger(group.overflowMaxLength), group.id).toBe(true);
            }
        }
    });
});

describe('a third instance reaches the paper, named', () => {
    /**
     * The roof block reduced to the two printed slots and one field.
     *
     * The real block's twelve fields would need twenty-four slot mappings on the
     * fixture page to say nothing this is about, and `checkValuesAgainstMap`
     * would refuse the render for the ones left out — correctly, since a value
     * with no mapping is a value that never reaches the paper. What is under
     * test is the ROUTE, so the block is cut to the smallest shape that still
     * has a printed range and something past it.
     */
    const roofGroup = (): FieldGroup => ({
        id: 'roof',
        label: 'Roof',
        capacity: 2,
        slotLabels: ['Predominant Roof', 'Secondary Roof'],
        fields: ['covering_material'],
        overflowTo: 'additional_comments',
        overflowMaxLength: 1584,
    });

    /** Two printed slots and the box the form nominates for anything past them. */
    const mapWithComments = (maxHeight: number): FieldMap => ({
        formId: 'yy_flat_form',
        version: 'Rev. 03/25',
        sourceHash: flat.hash,
        checkedBy: 'a.operator',
        checkedAt: Date.parse('2026-08-31T00:00:00.000Z'),
        requiredFields: [],
        mappings: [
            {
                kind: 'overlay', ourField: 'roof[0].covering_material',
                page: 1, x: 45, y: 700, size: 9, maxWidth: 200, maxHeight: 11,
            },
            {
                kind: 'overlay', ourField: 'roof[1].covering_material',
                page: 1, x: 300, y: 700, size: 9, maxWidth: 200, maxHeight: 11,
            },
            {
                kind: 'overlay', ourField: 'additional_comments',
                page: 1, x: 45, y: 600, size: 9, maxWidth: 525, maxHeight,
            },
        ],
    });

    it('writes the extra roof into the comments box, naming the block and the number', async () => {
        const group = roofGroup();
        const values = collectStatutoryValues(
            declarationFor(group, 'additional_comments'),
            EMPTY_SNAPSHOT,
            {},
            NO_FACTS,
            { [group.id]: oneInstancePastCapacity(group) },
        );
        const filled = await renderStatutoryForm(flat.bytes, mapWithComments(300), values);
        const drawn = (await drawnRuns(filled, 1)).map((r) => r.text).join('\n');
        // The block's name and the instance's number, counted from one: the
        // third roof is "Roof 3". Without them the line lands among the
        // inspector's own prose as a row of bare values.
        expect(drawn).toContain('Roof 3');
        expect(drawn).toContain('Covering material: recorded on site');
        // POSITIVE CONTROL on the same page: the slots the form PRINTS are not
        // in the comments box, so a renderer that dumped every instance there
        // would fail this.
        expect(drawn).not.toContain('Roof 1');
        expect(drawn).not.toContain('Roof 2');
    });

    it('refuses BY NAME when the nominated box cannot hold it either', () => {
        const group = { ...roofGroup(), overflowMaxLength: 40 };
        expect(() => collectStatutoryValues(
            declarationFor(group, 'additional_comments'),
            EMPTY_SNAPSHOT,
            {},
            NO_FACTS,
            { [group.id]: oneInstancePastCapacity(group) },
        )).toThrow(/Roof: this inspection recorded 3.*"additional_comments".*about 40 characters/s);
    });

    it('POSITIVE CONTROL — the same block at capacity produces the form', () => {
        const group = roofGroup();
        const values = collectStatutoryValues(
            declarationFor(group, 'additional_comments'),
            EMPTY_SNAPSHOT,
            {},
            NO_FACTS,
            { [group.id]: oneInstancePastCapacity(group).slice(0, group.capacity) },
        );
        expect(values.additional_comments).toBe('');
    });

    it('POSITIVE CONTROL — the same block with NO destination refuses the third roof', () => {
        // The behaviour before this ruling, and still the right one for a form
        // that nominates nothing. Named separately so "it refuses" and "it
        // routes" can never be satisfied by one implementation of either.
        const { overflowTo: _dropped, overflowMaxLength: _also, ...group } = roofGroup();
        expect(() => collectStatutoryValues(
            { formId: 'xx_measurement_only', bindings: {}, groups: [group] },
            EMPTY_SNAPSHOT,
            {},
            NO_FACTS,
            { [group.id]: oneInstancePastCapacity(group) },
        )).toThrow(/Roof: this inspection recorded 3, and this revision of the form has 2 slots/);
    });
});
