import { describe, it, expect } from 'vitest';
import seed from '../../../server/data/seed-templates/fl-citizens-4point-insp4pt.json';
import roofSeed from '../../../server/data/seed-templates/fl-citizens-roof-rcf-1.json';
import { fieldMap, version } from '../../../server/lib/statutory/forms/fl-citizens-4point';
import { PUBLISHED_FORM_VERSIONS } from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import { choiceLabel, choiceValue } from '../../../server/lib/template-choices';
import type {
    ItemChoice, StatutoryFormDeclaration, TemplateSchemaV2,
} from '../../../server/types/template-schema';

/**
 * The template that produces the Citizens four-point form, against the map of
 * that form.
 *
 * ── WHAT NO TEST HERE CAN CHECK ─────────────────────────────────────────────
 * Whether the wording is the authority's. Every `label` and every attribute
 * `name` in this template was read out of the published PDF's own content
 * streams — 105 strings, all of them found on the page, with a control proving
 * the search would have missed one derived from a field name
 * (`TPRV on water heater`: not on the form; `Remaining useful life (years):`:
 * on it). That check needs the PDF, the PDF is not in this repository, and it
 * is therefore recorded rather than repeated.
 *
 * ── WHAT IT CAN, AND WHY THAT IS THE CRUX ───────────────────────────────────
 * The correspondence that goes silently wrong is per question: the value an
 * inspector's answer is STORED as must equal that question's own `whenValue` on
 * the map, character for character, because `render.ts` matches with `===` and
 * nothing normalises. A template that stored the printed label instead
 * ("Cupping/curling" rather than `cupping_curling`) renders a COMPLETELY BLANK
 * official form and nothing throws — `checkChoicesAreReachable` only refuses an
 * answer that was given, and boxes nobody chose simply stay unticked.
 */
interface SeedAttribute { id: string; name: string; type: string; choices?: ItemChoice[] }
interface SeedItem { id: string; label: string; type: string; attributes?: SeedAttribute[] }

const schema = seed.schema as unknown as TemplateSchemaV2 & {
    statutoryForm: StatutoryFormDeclaration;
    ratingSystem?: unknown;
};
const decl = schema.statutoryForm;
const items = (schema.sections as unknown as { items: SeedItem[] }[]).flatMap((s) => s.items);
const formFields = new Set(fieldMap.mappings.map((m) => m.ourField));

/** Which answers the FORM has a box for, per field. The authority's side. */
const boxesByField = new Map<string, Set<string>>();
for (const m of fieldMap.mappings) {
    if (m.kind !== 'checkbox') continue;
    const known = boxesByField.get(m.ourField) ?? new Set<string>();
    known.add(m.whenValue);
    boxesByField.set(m.ourField, known);
}

/** Every attribute in the template, keyed the way a binding addresses one. */
// VALUES, not the pairs. An option now carries the authority's printed
// wording beside the token an answer is stored as, and everything below
// compares the TOKEN against the form's own `whenValue`.
const choicesByAttribute = new Map(
    items.flatMap((i) => (i.attributes ?? []).map(
        (a) => [`${i.id} ${a.id}`, new Set((a.choices ?? []).map(choiceValue))] as const,
    )),
);

describe('FL Citizens four-point Insp4pt 03 25 seed template', () => {
    it('binds only fields the form actually has', () => {
        // A binding for a field the map does not carry writes nowhere and says
        // nothing — there is no target for the renderer to refuse.
        const ghosts = Object.keys(decl.bindings).filter((k) => !formFields.has(k));
        expect(ghosts).toEqual([]);
    });

    it('leaves exactly the one field nothing can answer unbound, and no others', () => {
        // Named rather than counted: an unbound field renders blank, and a blank
        // box on an authority's form reads as an inspector who did not answer.
        // The one that is left has its reason written down in
        // `server/data/seed-templates/fl-citizens-4point-insp4pt.gaps.md`.
        const unbound = [...formFields].filter((f) => !(f in decl.bindings)).sort();
        expect(unbound).toEqual(['inspector_title']);
        expect(formFields.size).toBe(95);
        expect(Object.keys(decl.bindings)).toHaveLength(94);
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

    it('stores every choice the way the map reads it — character for character', () => {
        // THE CRUX. Both directions and both numbers: a template offering an
        // option the page has no box for prints nothing for that answer, and a
        // page box no option can reach is a question the software cannot answer.
        let checked = 0;
        for (const [field, boxes] of boxesByField) {
            const source = decl.bindings[field];
            expect(source, `${field} has boxes on the page and no binding`).toBeDefined();
            expect(source.from, field).toBe('item_attribute');
            if (source.from !== 'item_attribute') continue;
            const stored = choicesByAttribute.get(`${source.itemId} ${source.attribute}`);
            expect([...(stored ?? [])].sort(), field).toEqual([...boxes].sort());
            checked += 1;
        }
        // Zero would satisfy every assertion above vacuously. Counted on the
        // form: 44 questions with printed boxes.
        expect(checked).toBe(44);
    });

    it('shares the roof block\'s VALUES with the roof form and not its WORDING', () => {
        // Both Citizens forms print the same twelve roof questions. The stored
        // values are deliberately identical, so one inspection can feed both
        // forms without answering twice — and the wording is deliberately NOT,
        // because the two pages are punctuated differently and each template
        // carries the sentence its own form prints.
        const roofItems = (roofSeed.schema.sections as unknown as { items: SeedItem[] }[])
            .flatMap((s) => s.items);
        const roofAttrs = new Map((roofItems.find((i) => i.id === 'roof_predominant')?.attributes
            ?? []).map((a) => [a.id, a] as const));
        const ours = new Map((items.find((i) => i.id === 'roof_predominant')?.attributes ?? [])
            .map((a) => [a.id, a] as const));
        expect(ours.size).toBe(12);
        expect([...ours.keys()].sort()).toEqual([...roofAttrs.keys()].sort());
        let differ = 0;
        let labelsDiffer = 0;
        for (const [id, mine] of ours) {
            const theirs = roofAttrs.get(id)!;
            // VALUES: identical, asserted per attribute so a drift names itself.
            expect((mine.choices ?? []).map(choiceValue), id)
                .toEqual((theirs.choices ?? []).map(choiceValue));
            if (mine.name !== theirs.name) differ += 1;
            const myLabels = (mine.choices ?? []).map(choiceLabel);
            const theirLabels = (theirs.choices ?? []).map(choiceLabel);
            // Compared as JSON rather than joined on a separator: a joined
            // comparison is only as good as the separator not occurring in
            // the data, and these labels are the authority's punctuation.
            if (JSON.stringify(myLabels) !== JSON.stringify(theirLabels)) labelsDiffer += 1;
        }
        // Measured on the two PDFs: `Remaining useful life (years):` and
        // `Overall condition:` carry a colon here and none on the roof form.
        expect(differ).toBe(2);
        expect(ours.get('overall_condition')?.name).toBe('Overall condition:');
        expect(roofAttrs.get('overall_condition')?.name).toBe('Overall condition');
        // And exactly ONE choice list is worded differently. Measured on the
        // two PDFs at the word-box level: the parenthetical sits on the same
        // printed line as the No box on both, and RCF-1 puts a comma after
        // "yes" where this form does not. Copying one form's wording to the
        // other would make this zero — which is why it is asserted as one and
        // named, rather than left as "they may differ".
        expect(labelsDiffer).toBe(1);
        const leaks = (a: SeedAttribute | undefined) => (a?.choices ?? []).map(choiceLabel);
        expect(leaks(ours.get('visible_signs_of_leaks')))
            .toEqual(['Yes', 'No (If "yes" explain below)']);
        expect(leaks(roofAttrs.get('visible_signs_of_leaks')))
            .toEqual(['Yes', 'No (If "yes", explain below)']);
    });

    it('carries no rating system, because this form has no single judgement axis', () => {
        // 44 questions over 55 distinct values, and no axis they share. One
        // rating system per question would be the mechanism used backwards.
        expect(schema.ratingSystem).toBeUndefined();
        const distinct = new Set([...boxesByField.values()].flatMap((s) => [...s]));
        expect(distinct.size).toBe(55);
    });

    it('names the form the PUBLISHED version names, not a plausible spelling of it', () => {
        // Asserted against `version`, never against a literal chosen here: a
        // string picked in the same commit as the declaration agrees with itself
        // while the real selector matches nothing and the form is silently
        // offered as unavailable.
        expect(decl.formId).toBe(version.formId);
        expect(decl.revision).toBe(version.version);
        expect(versionForInspection(
            decl.formId, Date.UTC(2026, 7, 20), PUBLISHED_FORM_VERSIONS,
        )).not.toBeNull();
    });

    it('declares the two repeated blocks the form prints, with the form\'s own slot names', () => {
        // `Predominant` and `Secondary` carry meaning — predominant is the
        // surface that covers most of the dwelling — so slot 0 is not "the first
        // roof recorded". Same for Main and Second Panel.
        const groups = decl.groups ?? [];
        expect(groups.map((g) => g.id)).toEqual(['electrical_panel', 'roof']);
        for (const g of groups) {
            expect(g.slotLabels, g.id).toHaveLength(g.capacity);
            // Every slot of every field is a blank the form prints, so each has
            // to be bound: an unbound slot renders empty and reads as unanswered.
            for (let i = 0; i < g.capacity; i += 1) {
                for (const f of g.fields) {
                    expect(decl.bindings, `${g.id}[${i}].${f}`)
                        .toHaveProperty(`${g.id}[${i}].${f}`);
                }
            }
        }
        expect(groups[0].slotLabels).toEqual(['Main Panel', 'Second Panel']);
        expect(groups[1].slotLabels).toEqual(['Predominant Roof', 'Secondary Roof']);
    });

    it('supplies every REQUIRED answer except the mark, which travels separately', () => {
        // 23 required fields. The signature deliberately emits NO key — a mark
        // resolves by reference in the produce service and must never travel
        // through the values — so exactly one of the 23 is missing here, and
        // that one is supplied to the renderer through `signatures`.
        expect(fieldMap.requiredFields).toHaveLength(23);
        const values = collectStatutoryValues(decl, schema, answeredResults(), {
            client_name: 'A', client_email: null, client_phone: null,
            property_address: 'B', property_city: null, property_state: null,
            property_zip: null, inspection_date: '08/26/2026', inspector_name: 'C',
            inspector_license: 'D', company_name: 'E', company_phone: 'F',
            inspector_license_type: 'G', inspector_qualification: null,
            inspector_signature_date: '08/28/2026',
            owner_name: null, owner_email: null, owner_mailing_address: null,
            owner_home_phone: null, owner_work_phone: null, owner_cell_phone: null,
            employee_printed_name: null,
        }, {});
        const missing = fieldMap.requiredFields.filter((f) => !(f in values));
        expect(missing).toEqual(['inspector_signature']);
        // ⚠️ AND NONE OF THEM IS EMPTY. `render.ts` refuses a required field
        // that resolves to nothing exactly as it refuses one nobody bound, so a
        // required answer this template cannot carry stops the document rather
        // than printing a blank box over the inspector's signature.
        const blank = fieldMap.requiredFields.filter((f) => values[f] === '');
        expect(blank).toEqual([]);
        // Both numbers. 94 bindings less the signature is 93 keys, so 2 of the
        // form's 95 blanks reach the renderer with nothing at all: the
        // signature, and `inspector_title` from gaps.md §1.
        expect(Object.keys(values)).toHaveLength(93);
        expect([...formFields].filter((f) => !(f in values)).sort()).toEqual([
            'inspector_signature',
            'inspector_title',
        ]);
    });
});

/**
 * One answer for every attribute the template declares.
 *
 * Built from the template rather than typed out, because the point of the
 * assertion it feeds is that no REQUIRED field comes back empty — and a
 * hand-written answer set would prove that only for the answers somebody
 * remembered to write.
 */
function answeredResults(): Record<string, { value?: unknown; attributes?: Record<string, unknown> }> {
    const results: Record<string, { value?: unknown; attributes?: Record<string, unknown> }> = {};
    for (const item of items) {
        if (!item.attributes?.length) { results[item.id] = { value: 'x' }; continue; }
        const attributes: Record<string, unknown> = {};
        for (const a of item.attributes) {
            // `choiceValue`, so the synthetic answer set is what an inspector's
            // click actually stores. Taking `a.choices[0]` raw would hand the
            // renderer an OBJECT, which stringifies to "[object Object]" on the
            // authority's form -- exactly the class of defect this file exists
            // to catch, and one that would not have thrown.
            attributes[a.id] = a.choices?.length
                ? (a.type === 'multi_select'
                    ? [choiceValue(a.choices[0])]
                    : choiceValue(a.choices[0]))
                : 'x';
        }
        results[item.id] = { attributes };
    }
    return results;
}
