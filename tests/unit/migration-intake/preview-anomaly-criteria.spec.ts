/**
 * What the preview's anomaly criteria can and cannot be told from the data.
 *
 * ── The criterion this file exists for ──────────────────────────────────────
 * The design names four anomalies, and the first is a DISAGREEMENT: the
 * operator answered that his template's words are ratings, and yet items came
 * through as plain text. Evaluating it needs two things — his answer, and a
 * per-item landing that can differ from it.
 *
 * The answer is not stored: the report re-derives a starting mapping from the
 * file on every read, so what comes back is the default rather than what he
 * chose. That was recorded as the reason the criterion is not evaluable, and it
 * is still true. But it is not the binding reason, and the assertions below are
 * the ones that show why: BOTH template adapters give every item in a template
 * the SAME shape, and for the one that takes a rating answer that shape IS the
 * answer. So the two sides of the comparison cannot differ — not because we
 * lost the answer, but because no template this software can currently produce
 * carries two landings at once.
 *
 * ⚠️ WHEN A TEST HERE GOES RED, THAT IS THE SIGNAL. An adapter that emits a
 * mixed template makes the first criterion evaluable and unimplemented, and the
 * preview's "some came through weaker than the rest" rule stops being the same
 * test in the only form the data supports.
 */
import { describe, it, expect } from 'vitest';
import { homeInspectorProAdapter } from '../../../server/lib/migration-intake/adapters/home-inspector-pro';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { buildBatchStructure } from '../../../server/services/migration-intake/structure';
import type { EntityCounts } from '../../../server/lib/migration-intake/bundle';
import type { BundleResult } from '../../../server/lib/migration-intake/adapters/types';
import { zipOf } from '../helpers/zip-fixture';

/** Two panes, two panels each — so "every item landed the same way" is a claim. */
const TPL = `<?xml version="1.0" encoding="UTF-8"?>
<java version="10.0.2" class="java.beans.XMLDecoder">
 <object class="example.TemplateInfo">
  <void property="templateName"><string>Whole House Checklist</string></void>
  <void property="ratingNames">
   <void method="add"><string>Satisfactory</string></void>
   <void method="add"><string>Marginal</string></void>
  </void>
  <void property="tabbedPanesList">
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>Roof</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Covering</string></void></object></void>
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Flashing</string></void></object></void>
     </void>
   </object></void>
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>Interior</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Walls</string></void></object></void>
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>Floors</string></void></object></void>
     </void>
   </object></void>
  </void>
 </object>
</java>`;

const NO_DROPS: EntityCounts = { readFromSource: 1, emitted: 1, dropped: [] };

/** A workbook shaped like Spectora's export button, built rather than checked in. */
async function spectoraExport(): Promise<Uint8Array> {
    const rows = [
        ['Section Name', 'Item Name', 'Comment Name', 'Comment Text', 'Comment Type (info, limit, defect)'],
        ['Roof', 'Covering', 'Worn', 'The covering is worn.', 'defect'],
        ['Roof', 'Flashing', 'Rusted', 'The flashing is rusted.', 'defect'],
        ['Interior', 'Walls', 'Cracked', 'The wall is cracked.', 'info'],
    ];
    const cell = (v: string, col: number, row: number) =>
        `<c r="${String.fromCharCode(65 + col)}${row}" t="str"><v>${v}</v></c>`;
    const body = rows.map((r, i) =>
        `<row r="${i + 1}">${r.map((v, c) => cell(v, c, i + 1)).join('')}</row>`).join('');
    return zipOf({
        'xl/worksheets/sheet1.xml':
            `<?xml version="1.0"?><worksheet><sheetData>${body}</sheetData></worksheet>`,
    });
}

/** Every item's landing, in order, exactly as the preview screen reads them. */
function landings(result: BundleResult): string[] {
    if (!result.ok) throw new Error(`convert refused: ${result.error.message}`);
    const structure = buildBatchStructure(result.bundle.templates, NO_DROPS, result.bundle.manifest.warnings);
    if (structure === null) throw new Error('no structure produced');
    return structure.sections.flatMap((s) => s.items.map((i) => i.landedAs));
}

/** The same bytes every time — the fixture is a constant, not a variable. */
const hipBytes = (): Promise<Uint8Array> => zipOf({ 'TabbedPanes.tpl': TPL });

const asHip = async (ratingKind: 'severity' | 'choices' | 'none'): Promise<string[]> =>
    landings(await homeInspectorProAdapter.convert(await hipBytes(), {
        name: 'Whole House Checklist', ratingKind,
    }));

const asSpectora = async (): Promise<string[]> =>
    landings(await spectoraAdapter.convert(await spectoraExport(), { name: 'Spectora Master' }));

describe('the answer decides every item, so it can never disagree with one', () => {
    it('lands all four as rated when the words are severity', async () => {
        expect(await asHip('severity')).toEqual(['rated', 'rated', 'rated', 'rated']);
    });

    it('lands all four as choices when the words record what was found', async () => {
        expect(await asHip('choices')).toEqual(['choices', 'choices', 'choices', 'choices']);
    });

    it('lands all four as plain when the operator says they are not ratings', async () => {
        // And this is the shape the preview reports as a wholesale downgrade.
        // It is the operator's own answer being carried out, which is why that
        // banner is worded as a fact rather than as an accusation.
        expect(await asHip('none')).toEqual(['plain', 'plain', 'plain', 'plain']);
    });

    it('gives three DIFFERENT answers to the same bytes — the comparison', async () => {
        // Without this, each assertion above would also hold for an adapter
        // that ignored the answer and always produced that one shape.
        const shapes = [await asHip('severity'), await asHip('choices'), await asHip('none')];
        expect(new Set(shapes.map((s) => s.join())).size).toBe(3);
    });
});

describe('the other template adapter takes no answer at all', () => {
    it('lands every item as rated, whatever the file says', async () => {
        // Spectora's vocabulary files COMMENTS into the three tabs, so there is
        // no rating question to ask and none is passed. An item that came out
        // of here as plain text would mean the first anomaly criterion had
        // acquired a case — and it would have no answer to compare against.
        expect(await asSpectora()).toEqual(['rated', 'rated', 'rated']);
    });
});

describe('the invariant the first criterion rests on', () => {
    it('produces no template carrying two different landings', async () => {
        // ⚠️ The load-bearing assertion in this file. While it holds, "the
        // answer disagrees with an item" has no case to describe, and the
        // preview's mixed-landing rule is the same comparison in the only form
        // the data supports. When it fails, the first criterion has become
        // evaluable and is not implemented.
        const produced = [
            await asHip('severity'), await asHip('choices'),
            await asHip('none'), await asSpectora(),
        ];
        expect(produced.map((l) => new Set(l).size)).toEqual([1, 1, 1, 1]);
    });
});
