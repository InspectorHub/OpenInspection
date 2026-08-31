/**
 * A question with several boxes may have several of them ticked.
 *
 * -- The failure this exists to stop ------------------------------------------
 * `values` was `Record<string, string>` and the renderer marked a box where
 * `values.get(field) === whenValue`, so one answer could ever mark one box.
 * Counted on the two Florida forms and the Texas one: `photo_requirements_included`
 * has 6 boxes, `electrical.hazards_present` 13, `electrical.wiring_types` 8,
 * `plumbing.pipe_types` 8, `roof[*].damage_signs` 8, and the 1802's
 * `roof_covering_types` 7 -- every one of them plainly multi-select on the
 * printed page. A house with aluminium wiring AND knob-and-tube could report
 * exactly one of them, and the form that came out said the other was not there.
 *
 * -- What an ARRAY means, and what an EMPTY one means -------------------------
 * An array marks every box whose `whenValue` it contains. A plain string is
 * unchanged: it marks the one box it names.
 *
 * An EMPTY array is refused. "None of these boxes" already has a spelling in
 * this subsystem -- the empty string, which every layer already treats as an
 * explicit answer of nothing -- and a second spelling of one answer is a
 * permanent question at every read site about which one a given producer emits.
 * An empty array is also what a collector that found nothing produces, and on a
 * statutory form a question with no box ticked is indistinguishable from a
 * question nobody read.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { renderStatutoryForm } from '../../../server/lib/statutory/render';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type { StatutoryInspectionFacts } from '../../../server/lib/statutory/values';
import type { FieldMap } from '../../../server/lib/statutory/field-map';
import type { FieldGroup, StatutoryFormDeclaration, TemplateSchemaV2 }
    from '../../../server/types/template-schema';
import { buildFlatPdf, type PdfFixture } from '../helpers/statutory-pdf-fixtures';
import { drawnRuns } from '../helpers/pdf-drawn-runs';

let flat: PdfFixture;

beforeAll(async () => {
    flat = await buildFlatPdf();
});

/** Four boxes for one question, plus one drawn value to write beside them. */
const multiSelectMap = (): FieldMap => ({
    formId: 'yy_flat_form',
    version: 'Rev. 04/26',
    sourceHash: flat.hash,
    checkedBy: 'a.operator',
    checkedAt: Date.parse('2026-08-29T00:00:00.000Z'),
    requiredFields: [],
    mappings: [
        { kind: 'checkbox', ourField: 'wiring_types', whenValue: 'copper', page: 1, x: 80, y: 400 },
        { kind: 'checkbox', ourField: 'wiring_types', whenValue: 'aluminum', page: 1, x: 120, y: 400 },
        { kind: 'checkbox', ourField: 'wiring_types', whenValue: 'knob_and_tube', page: 1, x: 160, y: 400 },
        { kind: 'checkbox', ourField: 'wiring_types', whenValue: 'nm_bx_or_conduit', page: 1, x: 200, y: 400 },
        { kind: 'overlay', ourField: 'owner.name', page: 1, x: 100, y: 500, size: 10 },
    ],
});

/** Which x-coordinates on page 1 carry a mark. */
async function markedAt(bytes: Uint8Array): Promise<number[]> {
    const runs = await drawnRuns(bytes, 1);
    return runs.filter((r) => r.text === 'X').map((r) => r.x).sort((a, b) => a - b);
}

describe('an answer that ticks several boxes', () => {
    it('marks every box the array names', async () => {
        const filled = await renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['aluminum', 'knob_and_tube'],
        });
        expect(await markedAt(filled)).toEqual([120, 160]);
    });

    it('marks NO box the array does not name', async () => {
        // The assertion the bug also satisfies is "the right box is ticked". A
        // renderer that marked all four would pass that and produce a form
        // saying the house has every kind of wiring there is.
        const filled = await renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['copper'],
        });
        expect(await markedAt(filled)).toEqual([80]);
    });

    it('POSITIVE CONTROL — a plain string still marks exactly its own box', async () => {
        const filled = await renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: 'knob_and_tube',
        });
        expect(await markedAt(filled)).toEqual([160]);
    });

    it('marks every box named even when the array names all of them', async () => {
        const filled = await renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['copper', 'aluminum', 'knob_and_tube', 'nm_bx_or_conduit'],
        });
        expect(await markedAt(filled)).toEqual([80, 120, 160, 200]);
    });
});

describe('a repeated block whose instance answered several boxes', () => {
    /**
     * The one place the narrow pipe survived, exercised through the real
     * collector rather than against the helper it calls.
     *
     * `expandGroups` stringified every instance value with `String()`, so a slot
     * holding ['cracking','cupping_curling'] reached the renderer as
     * "cracking,cupping_curling" and ticked no box at all. Asserting on
     * `asAnswer` in isolation would not have caught it: the helper was already
     * right, and nothing called it here.
     */
    const ROOF: FieldGroup = {
        id: 'roof',
        label: 'Roof',
        capacity: 1,
        slotLabels: ['Predominant Roof'],
        fields: ['damage_signs'],
    };
    const DECLARATION: StatutoryFormDeclaration = {
        formId: 'yy_flat_form', bindings: {}, groups: [ROOF],
    };
    // The declaration binds nothing, so no inspection fact is ever read. Spelled
    // as an empty object rather than a copy of the fact list, which would be a
    // second copy to keep in step for no benefit.
    const NO_FACTS = {} as StatutoryInspectionFacts;
    const EMPTY_SNAPSHOT = { schemaVersion: 2, sections: [] } as unknown as TemplateSchemaV2;

    /** Four boxes for the one printed slot's damage-signs question. */
    const slotMap = (): FieldMap => ({
        ...multiSelectMap(),
        mappings: [
            { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cracking', page: 1, x: 80, y: 300 },
            { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'cupping_curling', page: 1, x: 120, y: 300 },
            { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'granule_loss', page: 1, x: 160, y: 300 },
            { kind: 'checkbox', ourField: 'roof[0].damage_signs', whenValue: 'missing_tabs', page: 1, x: 200, y: 300 },
        ],
    });

    const collect = (instance: Record<string, unknown>) => collectStatutoryValues(
        DECLARATION, EMPTY_SNAPSHOT, {}, NO_FACTS, { roof: [instance] },
    );

    it('ticks every box the recorded instance names', async () => {
        const filled = await renderStatutoryForm(
            flat.bytes, slotMap(), collect({ damage_signs: ['cracking', 'granule_loss'] }),
        );
        expect(await markedAt(filled)).toEqual([80, 160]);
    });

    it('ticks NO box the instance does not name', async () => {
        const filled = await renderStatutoryForm(
            flat.bytes, slotMap(), collect({ damage_signs: ['missing_tabs'] }),
        );
        expect(await markedAt(filled)).toEqual([200]);
    });

    it('POSITIVE CONTROL — a slot answered with one value still ticks its own box', async () => {
        const filled = await renderStatutoryForm(
            flat.bytes, slotMap(), collect({ damage_signs: 'cupping_curling' }),
        );
        expect(await markedAt(filled)).toEqual([120]);
    });

    it('POSITIVE CONTROL — a slot nobody answered ticks nothing and still renders', async () => {
        const filled = await renderStatutoryForm(flat.bytes, slotMap(), collect({}));
        expect(await markedAt(filled)).toEqual([]);
    });
});

describe('an answer with no box for it', () => {
    it('refuses, naming the element the form has no box for', async () => {
        // The dangerous shape: three of the four are fine, so every count of
        // mapped fields and answered questions looks complete, and the fourth
        // silently marks nothing.
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['copper', 'aluminum', 'greenfield'],
        })).rejects.toThrow(/greenfield/);
    });

    it('does not name the elements that WERE reachable', async () => {
        // A message that listed the whole answer would send the reader looking
        // through three good values for the bad one.
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['copper', 'greenfield'],
        })).rejects.toThrow(/was answered "greenfield"/);
    });

    it('POSITIVE CONTROL — every element reachable renders', async () => {
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: ['copper', 'aluminum'],
        })).resolves.toBeInstanceOf(Uint8Array);
    });
});

describe('an empty answer', () => {
    it('refuses an empty array, and says how to answer "none of these"', async () => {
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: [],
        })).rejects.toThrow(/wiring_types/);
    });

    it('POSITIVE CONTROL — the empty string IS "none of these" and marks nothing', async () => {
        const filled = await renderStatutoryForm(flat.bytes, multiSelectMap(), {
            wiring_types: '',
        });
        expect(await markedAt(filled)).toEqual([]);
    });
});

describe('an array where no box could take it', () => {
    it('refuses an array on an overlay rather than inventing a separator', async () => {
        // There is no right answer to "how do you draw a list on one printed
        // line". Joining it would put a separator on a statutory form on our own
        // authority, and the form prints its own.
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            'owner.name': ['Zoe Ng', 'Sam Ng'],
        })).rejects.toThrow(/owner\.name/);
    });

    it('POSITIVE CONTROL — a string on that same overlay renders', async () => {
        await expect(renderStatutoryForm(flat.bytes, multiSelectMap(), {
            'owner.name': 'Zoe Ng',
        })).resolves.toBeInstanceOf(Uint8Array);
    });
});
