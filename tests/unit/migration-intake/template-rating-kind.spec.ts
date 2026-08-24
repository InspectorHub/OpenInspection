/**
 * What the operator's own rating words MEAN, and what the conversion does about it.
 *
 * ── Why this question exists ────────────────────────────────────────────────
 * Twenty-two real templates showed vocabularies of three, four and five
 * entries sharing no words — severity scales, yes/no checklists, statutory
 * codes — and eight with none at all. No mapping from that to our item types
 * can be written in code, so it is asked. But it is asked in the OPERATOR's
 * terms: what the words say, never what we would store them as.
 *
 * ── Why the question is not asked of every template ─────────────────────────
 * A template export can carry a vocabulary that describes its COMMENTS rather
 * than its items, and that one is already settled — the words are the three
 * comment tabs, so the mapping is the identity and asking the operator to
 * re-derive a fact about his own file is work with no answer to give. The
 * inspection therefore says which of the two its vocabulary is, and the
 * question is asked of one and not the other.
 *
 * Every assertion below COMPARES two conversions of the SAME bytes differing
 * only in the answer. "An item is produced" is true of every conversion there
 * has ever been.
 */
import { describe, it, expect } from 'vitest';
import { homeInspectorProAdapter } from '../../../server/lib/migration-intake/adapters/home-inspector-pro';
import { spectoraAdapter } from '../../../server/lib/migration-intake/adapters/spectora';
import { defaultMappingFor } from '../../../server/lib/migration-intake/adapters/registry';
import { intakeSourceFromBytes } from '../../../server/lib/migration-intake/adapters/source';
import { parseMigrationBundle } from '../../../server/lib/validations/migration-bundle.schema';
import { zipOf } from '../helpers/zip-fixture';
import type { TemplateItem } from '../../../server/types/template-schema';

const TPL = `<?xml version="1.0" encoding="UTF-8"?>
<java version="10.0.2" class="java.beans.XMLDecoder">
 <object class="example.TemplateInfo">
  <void property="templateName"><string>Commercial Inspection - Full</string></void>
  <void property="ratingNames">
   <void method="add"><string> Yes</string></void>
   <void method="add"><string>No</string></void>
   <void method="add"><string>N/A</string></void>
  </void>
  <void property="tabbedPanesList">
   <void method="add"><object class="example.SavedTabbedPane">
     <void property="tabbedPaneName"><string>First Area</string></void>
     <void property="savedPanels">
       <void method="add"><object class="example.SavedPanel">
         <void property="panelName"><string>One</string></void></object></void>
     </void>
   </object></void>
  </void>
 </object>
</java>`;

const template = (tpl = TPL): Promise<Uint8Array> => zipOf({ 'TabbedPanes.tpl': tpl });

/** A workbook shaped like the export button's file, built rather than checked in. */
async function spectoraExport(): Promise<Uint8Array> {
    const rows = [
        ['Section Name', 'Item Name', 'Comment Name', 'Comment Text', 'Comment Type (info, limit, defect)'],
        ['Roof', 'Covering', 'Worn', 'The covering is worn.', 'defect'],
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

async function firstItem(
    bytes: Uint8Array,
    ratingKind: 'severity' | 'choices' | 'none',
): Promise<TemplateItem> {
    const result = await homeInspectorProAdapter.convert(bytes, { name: 'X', ratingKind });
    if (!result.ok) throw new Error(`convert refused: ${result.error.message}`);
    const parsed = parseMigrationBundle(result.bundle);
    // Every arm has to produce a bundle the format validator accepts, or the
    // answer would stage a run that can never be applied.
    expect(parsed.ok === false ? parsed.issues : []).toEqual([]);
    const item = result.bundle.templates[0]?.schema.sections[0]?.items[0];
    if (!item) throw new Error('no item produced');
    return item;
}

describe('what the vocabulary describes', () => {
    it('says a template whose words rate ITEMS carries an item vocabulary', async () => {
        const got = await homeInspectorProAdapter.inspect?.(await template());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratingsDescribe).toBe('items');
    });

    it('says an export whose words file COMMENTS carries a comment vocabulary', async () => {
        // The positive control, and the reason the field exists. This export's
        // `info / limit / defect` are already our three comment tabs, so there
        // is nothing to classify — and a wizard that could not tell the two
        // vocabularies apart would ask about this one too, in words that would
        // make no sense against it.
        const got = await spectoraAdapter.inspect?.(await spectoraExport());
        if (got?.kind !== 'template') throw new Error('unreachable');
        expect(got.ratingsDescribe).toBe('comments');
    });
});

describe('converting by what the operator said the words mean', () => {
    it('keeps a severity scale as a rated item, in the operator\'s own words', async () => {
        const item = await firstItem(await template(), 'severity');
        expect(item.type).toBe('rich');
        expect(item.ratingOptions).toEqual([' Yes', 'No', 'N/A']);
    });

    it('turns a list of findings into a list of choices', async () => {
        const item = await firstItem(await template(), 'choices');
        expect(item.type).toBe('select');
        expect(item.options?.choices).toEqual([' Yes', 'No', 'N/A']);
        // And it stops being a rated item, which is the half that would
        // otherwise pass unnoticed: an item carrying both is two answers.
        expect(item.ratingOptions).toBeUndefined();
    });

    it('drops the vocabulary entirely when the operator says they are not ratings', async () => {
        const item = await firstItem(await template(), 'none');
        expect(item.type).toBe('textarea');
        expect(item.ratingOptions).toBeUndefined();
        expect(item.options?.choices).toBeUndefined();
    });

    it('gives three DIFFERENT answers to the same bytes — the comparison', async () => {
        // Each assertion above would pass against an adapter that ignored the
        // answer and happened to produce that one shape. This one cannot.
        const bytes = await template();
        const kinds = await Promise.all(
            (['severity', 'choices', 'none'] as const).map((k) => firstItem(bytes, k)),
        );
        expect(new Set(kinds.map((i) => i.type)).size).toBe(3);
    });

    it('is still PURE — the same bytes and the same answer convert alike', async () => {
        const bytes = await template();
        const first = await homeInspectorProAdapter.convert(bytes, { name: 'X', ratingKind: 'choices' });
        const second = await homeInspectorProAdapter.convert(bytes, { name: 'X', ratingKind: 'choices' });
        expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    });

    it('has our own words to fall back on only where the file supplies none', async () => {
        // Eight of twenty-two carry no vocabulary. A rated item still needs
        // options, so it gets ours — and this is the only case where it does.
        const noRatings = TPL.replace(/ *<void property="ratingNames">[\s\S]*?<\/void>\n/, '');
        const item = await firstItem(await template(noRatings), 'severity');
        expect(item.type).toBe('rich');
        expect(item.ratingOptions?.length).toBeGreaterThan(0);
        expect(item.ratingOptions).not.toContain(' Yes');
    });
});

describe('the answer the wizard starts from', () => {
    it('starts a template mapping at the answer that changes nothing', async () => {
        // The default has to be the reading that preserves what the file
        // already says: its words become the item's rating options, verbatim.
        // Any other default would silently restructure a template for an
        // operator who never opened the step.
        const bytes = await template();
        const inspection = await homeInspectorProAdapter.inspect?.(bytes);
        const mapping = defaultMappingFor(
            'templates.create',
            inspection ?? null,
            intakeSourceFromBytes('Whole House Checklist.tpz', bytes),
        );
        expect(mapping.kind).toBe('template');
        if (mapping.kind !== 'template') throw new Error('unreachable');
        expect(mapping.ratingKind).toBe('severity');
        expect(mapping.name).toBe('Commercial Inspection - Full');
    });
});
