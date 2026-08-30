import { describe, it, expect } from 'vitest';
import seed from '../../../server/data/seed-templates/fl-oir-b1-1802-rev-04-26.json';
import { fieldMap, version } from '../../../server/lib/statutory/forms/fl-oir-b1-1802';
import { PUBLISHED_FORM_VERSIONS } from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import { refuseUnusableDependencies } from '../../../server/lib/statutory/applicability';
import type {
    StatutoryFormDeclaration, TemplateSchemaV2,
} from '../../../server/types/template-schema';

/**
 * The template that produces FL OIR-B1-1802, against the map of that form.
 *
 * ── WHAT NO TEST HERE CAN CHECK ─────────────────────────────────────────────
 * Whether the wording is the Office's. Every `label`, every attribute `name`
 * and every transcribed line of every `description` was read off the published
 * PDF: 169 lines found on the page verbatim and 16 more composed of parts that
 * are, with 16 marked as this template's own voice. A planted line
 * (`Roof Slope: For single family homes…`, the printed text with one hyphen
 * removed) was reported missing, which is what makes the 169 mean something.
 * That check needs the PDF, the PDF is not in this repository, and it is
 * therefore recorded rather than repeated.
 *
 * ── WHAT IT CAN, AND WHY THAT IS THE CRUX ───────────────────────────────────
 * This form's answers are BARE LETTERS — `A`, `B`, `C`, `D`, `X`, `Z`, `NA` —
 * and `render.ts` matches `value === whenValue` with nothing normalising. A
 * template storing the printed label ("A - Wood frame") instead produces a
 * completely blank official form and nothing throws:
 * `checkChoicesAreReachable` only refuses an answer that WAS given, and boxes
 * nobody chose simply stay unticked.
 */
interface SeedAttribute { id: string; name: string; type: string; choices?: string[] }
interface SeedItem { id: string; label: string; type: string; description?: string; attributes?: SeedAttribute[] }

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

const choicesByAttribute = new Map(
    items.flatMap((i) => (i.attributes ?? []).map(
        (a) => [`${i.id} ${a.id}`, new Set(a.choices ?? [])] as const,
    )),
);

/** The facts an inspection supplies, all present so nothing resolves empty. */
const FACTS = {
    client_name: 'A', client_email: null, client_phone: null,
    property_address: 'B', property_city: null, property_state: null,
    property_zip: null, inspection_date: '08/24/2026', inspector_name: 'C',
    inspector_license: 'D', company_name: 'E', company_phone: 'F',
    inspector_license_type: 'G', inspector_qualification: 'home_inspector',
    inspector_signature_date: '08/27/2026',
    owner_name: 'H', owner_email: 'I', owner_mailing_address: 'J',
    owner_home_phone: 'K', owner_work_phone: 'L', owner_cell_phone: 'M',
    employee_printed_name: 'N',
};

describe('FL OIR-B1-1802 Rev. 04/26 seed template', () => {
    it('binds only fields the form actually has', () => {
        const ghosts = Object.keys(decl.bindings).filter((k) => !formFields.has(k));
        expect(ghosts).toEqual([]);
    });

    it('leaves exactly the seven fields nothing can answer unbound, and no others', () => {
        // Named rather than counted: an unbound field renders blank, and a blank
        // box on an authority's form reads as an inspector who did not answer.
        // Each one's reason is in
        // `server/data/seed-templates/fl-oir-b1-1802-rev-04-26.gaps.md`.
        const unbound = [...formFields].filter((f) => !(f in decl.bindings)).sort();
        expect(unbound).toEqual([
            'contact_person',
            'homeowner_signature',
            'homeowner_signature_date',
            'inspector_initials',
            'owner_city',
            'owner_county',
            'owner_zip',
        ]);
        expect(formFields.size).toBe(96);
        expect(Object.keys(decl.bindings)).toHaveLength(89);
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
        // THE CRUX, and on this form the values are bare letters. Both
        // directions and both numbers: a template offering an option the page
        // has no box for prints nothing for that answer, and a page box no
        // option can reach is a question the software cannot answer.
        let checked = 0;
        for (const [field, boxes] of boxesByField) {
            const source = decl.bindings[field];
            expect(source, `${field} has boxes on the page and no binding`).toBeDefined();
            if (field === 'inspector_qualification') {
                // The one exception, and it is a decision rather than an
                // oversight: the qualification is a fact about the SIGNER, so it
                // reads their profile. See gaps.md §2.1 — that column is free
                // text, and an answer outside this set is refused by name at
                // produce time rather than printed blank.
                expect(source.from).toBe('inspection');
                continue;
            }
            expect(source.from, field).toBe('item_attribute');
            if (source.from !== 'item_attribute') continue;
            const stored = choicesByAttribute.get(`${source.itemId} ${source.attribute}`);
            expect([...(stored ?? [])].sort(), field).toEqual([...boxes].sort());
            checked += 1;
        }
        // Zero would satisfy every assertion above vacuously. Counted on the
        // form: 34 questions with printed boxes, 33 of them answered from a
        // choice list this template declares.
        expect(boxesByField.size).toBe(34);
        expect(checked).toBe(33);
        const distinct = new Set([...boxesByField.values()].flatMap((s) => [...s]));
        expect(distinct.size).toBe(70);
    });

    it('carries the three conditional questions the form states in its own text', () => {
        // The only published form with `dependsOn`. Each rule is refused by
        // `applicability.ts` if it is unusable, so run that here rather than
        // restating its reasoning.
        const rules = decl.dependsOn ?? {};
        expect(Object.keys(rules).sort()).toEqual([
            'opening_protection_non_glazed_level',
            'roof_wall_attachment_minimal_condition',
            'sealed_roof_deck_spray_foam_underside_fully_covered',
        ]);
        expect(() => refuseUnusableDependencies(decl)).not.toThrow();
        // ⚠️ A conditional question must NOT also be required of every
        // inspection: the render would refuse a form whose missing key is the
        // correct output for the answers given.
        for (const field of Object.keys(rules)) {
            expect(fieldMap.requiredFields, field).not.toContain(field);
        }
        // Every answer a rule waits for is an answer the FORM has a box for.
        // A misspelling here makes the question silently never apply, and the
        // whole observable output is one unticked box.
        for (const [field, rule] of Object.entries(rules)) {
            const controlling = boxesByField.get(rule.field);
            expect(controlling, `${field} -> ${rule.field}`).toBeDefined();
            for (const answer of rule.answerIsOneOf) {
                expect([...controlling!], `${field} waits for ${answer}`).toContain(answer);
            }
            if (rule.labelSeparator === undefined) continue;
            for (const own of boxesByField.get(field) ?? []) {
                expect([...controlling!], `${field}=${own}`)
                    .toContain(own.split(rule.labelSeparator)[0]);
            }
        }
    });

    it('emits NO KEY for a question the form did not ask, not an empty one', () => {
        // The distinction this whole mechanism exists for. On a printed page the
        // two are the same blank; in the record they are "never asked" and "the
        // inspector answered nothing", and only this side can tell them apart.
        const results = answeredResults();
        // Question 6 answered A (toenails), which has no minimal conditions.
        results.question_6_roof_to_wall_attachment.attributes!.weakest_connection = 'A';
        delete results.question_6_minimal_conditions.attributes!.condition;
        results.question_8_sealed_roof_deck.attributes!.method = 'taped_deck_seams';
        results.question_8_sealed_roof_deck.attributes!.spray_foam_underside_fully_covered = null;
        results.question_9_opening_protection.attributes!.answer = 'X';
        results.question_9_opening_protection.attributes!.non_glazed_level = null;

        // `collectStatutoryValues` applies the rules itself — asserted here
        // rather than by calling `applyDependencies` again, because the fact
        // that matters is that the PRODUCE path does it, not that the helper
        // works when called by hand.
        const values = collectStatutoryValues(decl, schema, results, FACTS, {});
        for (const field of Object.keys(decl.dependsOn ?? {})) {
            expect(Object.prototype.hasOwnProperty.call(values, field), field).toBe(false);
        }
    });

    it('refuses an answer to a question the form did not ask, and names both', () => {
        const results = answeredResults();
        results.question_6_roof_to_wall_attachment.attributes!.weakest_connection = 'A';
        results.question_6_minimal_conditions.attributes!.condition = '2';
        expect(() => collectStatutoryValues(decl, schema, results, FACTS, {}))
            .toThrow(/roof_wall_attachment_minimal_condition.*roof_wall_attachment/s);
    });

    it('carries no rating system, because this form has no single judgement axis', () => {
        // 34 questions over 70 distinct values, and the values are the form's
        // own option letters. One rating system per question would be the
        // mechanism used backwards.
        expect(schema.ratingSystem).toBeUndefined();
        expect(decl.groups).toBeUndefined();
    });

    it('names the form the PUBLISHED version names, not a plausible spelling of it', () => {
        // Asserted against `version`, never against a literal chosen here: a
        // string picked in the same commit as the declaration agrees with itself
        // while the real selector matches nothing.
        expect(decl.formId).toBe(version.formId);
        expect(decl.revision).toBe(version.version);
        expect(versionForInspection(
            decl.formId, Date.UTC(2026, 7, 20), PUBLISHED_FORM_VERSIONS,
        )).not.toBeNull();
    });

    it('supplies every REQUIRED answer except the mark, which travels separately', () => {
        expect(fieldMap.requiredFields).toHaveLength(20);
        const values = collectStatutoryValues(decl, schema, answeredResults(), FACTS, {});
        // `inspector_signature` is not required on this form, so every one of
        // the twenty resolves — and none of them to nothing.
        const missing = fieldMap.requiredFields.filter((f) => !(f in values));
        expect(missing).toEqual([]);
        const blank = fieldMap.requiredFields.filter((f) => values[f] === '');
        expect(blank).toEqual([]);
        // Both numbers. 89 bindings less the signature is 88 keys, so 8 of the
        // form's 96 blanks reach the renderer with nothing at all: the seven in
        // gaps.md §1, and the signature that travels through its own channel.
        expect(Object.keys(values)).toHaveLength(88);
        expect([...formFields].filter((f) => !(f in values)).sort()).toEqual([
            'contact_person',
            'homeowner_signature',
            'homeowner_signature_date',
            'inspector_initials',
            'inspector_signature',
            'owner_city',
            'owner_county',
            'owner_zip',
        ]);
    });
});

/**
 * One answer for every attribute the template declares.
 *
 * Built from the template rather than typed out, because the point of the
 * assertion it feeds is that no REQUIRED field comes back empty — and a
 * hand-written answer set would prove that only for the answers somebody
 * remembered to write. The conditional questions are answered consistently with
 * their controlling question so the default set produces rather than refuses.
 */
function answeredResults(): Record<string, { value?: unknown; attributes?: Record<string, unknown> }> {
    const results: Record<string, { value?: unknown; attributes?: Record<string, unknown> }> = {};
    for (const item of items) {
        if (!item.attributes?.length) { results[item.id] = { value: 'x' }; continue; }
        const attributes: Record<string, unknown> = {};
        for (const a of item.attributes) {
            attributes[a.id] = a.choices?.length
                ? (a.type === 'multi_select' ? [a.choices[0]] : a.choices[0])
                : 'x';
        }
        results[item.id] = { attributes };
    }
    // `choices[0]` gives question 6 the answer `A`, question 8 `A` +
    // `fully_adhered_astm_d1970` and question 9 `A`; line them up with the
    // sub-answers so the default set is a form that could be filed.
    results.question_6_roof_to_wall_attachment.attributes!.weakest_connection = 'C';
    results.question_8_sealed_roof_deck.attributes!.method = 'spray_foam';
    results.question_9_opening_protection.attributes!.non_glazed_level = 'A.1';
    return results;
}
