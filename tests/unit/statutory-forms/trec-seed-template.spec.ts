import { describe, it, expect } from 'vitest';
import seed from '../../../server/data/seed-templates/trec-rei-7-6.json';
import { fieldMap } from '../../../server/lib/statutory/forms/tx-trec-rei-7-6';
import type { StatutoryFormDeclaration } from '../../../server/types/template-schema';

/**
 * The template that produces the Texas form, against the map of that form.
 *
 * -- WHY THIS EXISTS ---------------------------------------------------------
 * The template this replaced looked like a TREC template and was not one. It
 * carried 28 items where the Commission's form has 41 lettered sections: Walls
 * and Doors were each split in two where the form has one, Gas Distribution sat
 * under Optional Systems where the form puts it under Plumbing, and thirteen
 * sections were simply absent. Nothing was red. Every gate passed, and the only
 * observable symptom would have been an inspector pressing a button and getting
 * a document with thirteen blank sections on it.
 *
 * So these assertions are about CORRESPONDENCE, which is the property that went
 * missing silently: every binding names a field the form actually has, every
 * binding names an item this template actually contains, and the rating a
 * template stores is spelled the way the map expects to read it.
 */
const decl = (seed.schema as unknown as { statutoryForm: StatutoryFormDeclaration }).statutoryForm;
const sections = seed.schema.sections;
const items = sections.flatMap((s) => s.items);
const formFields = new Set(fieldMap.mappings.map((m) => m.ourField));

describe('TREC REI 7-6 seed template', () => {
    it('has one item per lettered section the Commission prints', () => {
        // 12 + 3 + 4 + 6 + 9 + 7. Counted on the form, not chosen.
        expect(items).toHaveLength(41);
        expect(sections.map((s) => s.items.length)).toEqual([12, 3, 4, 6, 9, 7]);
    });

    it('binds only fields the form actually has', () => {
        // A binding for a field the map does not carry writes nowhere and says
        // nothing -- there is no target for the renderer to refuse.
        const ghosts = Object.keys(decl.bindings).filter((k) => !formFields.has(k));
        expect(ghosts).toEqual([]);
    });

    it('leaves exactly the three fields nothing can answer unbound, and no others', () => {
        // Named rather than counted: an unbound field renders blank, and a blank
        // box on an authority's form reads as an inspector who did not answer.
        // `sponsor_*` has no column anywhere in this repository, and the
        // additional-information box is the inspector's own with no item behind
        // it. Adding a source for any of them means DELETING it from this list.
        const unbound = [...formFields].filter((f) => !(f in decl.bindings)).sort();
        expect(unbound).toEqual([
            'additional_information_provided_by_inspector',
            'sponsor_license_number',
            'sponsor_name',
        ]);
    });

    it('never names an item or attribute this template does not contain', () => {
        const itemIds = new Set(items.map((i) => i.id));
        const attrIds = new Set(
            items.flatMap((i) => (i.attributes ?? []).map((a) => `${i.id} ${a.id}`)),
        );
        for (const [field, source] of Object.entries(decl.bindings)) {
            if (source.from === 'item' || source.from === 'item_comments') {
                expect(itemIds, `${field} -> ${source.itemId}`).toContain(source.itemId);
            }
            if (source.from === 'item_attribute') {
                expect(attrIds, `${field} -> ${source.itemId}.${source.attribute}`)
                    .toContain(`${source.itemId} ${source.attribute}`);
            }
        }
    });

    it('binds every field the form REQUIRES', () => {
        for (const f of fieldMap.requiredFields) expect(decl.bindings).toHaveProperty(f);
    });

    it('spells its rating level ids the way the map reads them', () => {
        // THE CRUX. An inspection stores the rating LEVEL ID
        // (`findings.setRating(..., level.id)`), and `render.ts` matches a
        // checkbox with `value === whenValue` -- exact equality, no
        // normalisation. Ship `id: 'Inspected'` and all 164 marks silently fail
        // to appear while every other check in this repository stays green.
        const levelIds = new Set(seed.schema.ratingSystem.levels.map((l) => l.id));
        const ratingValues = new Set(
            fieldMap.mappings
                .filter((m) => m.kind === 'checkbox' && m.ourField.endsWith('_rating'))
                .map((m) => (m as { whenValue: string }).whenValue),
        );
        expect([...levelIds].sort()).toEqual([...ratingValues].sort());
    });

    it('defaults every canned entry OFF, because this document is a statement', () => {
        // An entry defaulting ON would compose into the Comments box of every
        // section the inspector never opened -- printing "was inspected and
        // appeared to be performing its intended function" over a section nobody
        // looked at, on a document the inspector signs. That is the one thing a
        // convenience default must not do here.
        for (const item of items) {
            for (const tab of ['information', 'limitations', 'defects'] as const) {
                for (const entry of item.tabs[tab]) {
                    expect(entry.default, `${item.id}.${tab}.${entry.id}`).toBe(false);
                }
            }
        }
    });

    it('declares the revision its bindings were authored against', () => {
        expect(decl.formId).toBe('tx_trec_rei');
        expect(decl.revision).toBe('7-6');
    });
});
