import { describe, it, expect } from 'vitest';
import seed from '../../../server/data/seed-templates/fl-citizens-roof-rcf-1.json';
import { fieldMap, version } from '../../../server/lib/statutory/forms/fl-citizens-roof';
import { PUBLISHED_FORM_VERSIONS } from '../../../server/lib/statutory/forms';
import { versionForInspection } from '../../../server/lib/statutory/form-registry';
import { collectStatutoryValues } from '../../../server/lib/statutory/values';
import type {
    StatutoryFormDeclaration, TemplateSchemaV2,
} from '../../../server/types/template-schema';

/**
 * The template that produces the Citizens roof form, against the map of that form.
 *
 * ── WHY THIS EXISTS, AND WHY IT IS NOT THE TREC SPEC AGAIN ──────────────────
 * TREC's template gets away with one embedded rating system because all 41 of
 * its items ask the same question. This form asks TWELVE different ones over
 * fourteen values, so there is no single axis to check — the correspondence that
 * can go silently wrong here is per question: the value an inspector's answer is
 * STORED as must equal that question's own `whenValue` on the map, character for
 * character, because `render.ts` matches with `===` and nothing normalises.
 *
 * A template that stored the printed label instead ("Full replacement" rather
 * than `full_replacement`) renders a COMPLETELY BLANK official form. Nothing
 * throws: `checkChoicesAreReachable` only refuses an answer that was given, and
 * the boxes simply stay unticked. That failure has happened on this branch once
 * already, which is why the vocabulary check below is the crux of this file.
 */
interface SeedAttribute { id: string; name: string; type: string; choices?: string[] }
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

describe('FL Citizens roof RCF-1 03 25 seed template', () => {
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
        // `server/data/seed-templates/fl-citizens-roof-rcf-1.gaps.md`. Adding a
        // source for it means DELETING it from this list — which is what
        // happened to `inspector_license_type` and `inspector_signature_date`:
        // both got a column of their own rather than an alias of one that
        // already existed.
        const unbound = [...formFields].filter((f) => !(f in decl.bindings)).sort();
        expect(unbound).toEqual(['inspector_title']);
        expect(formFields.size).toBe(36);
        expect(Object.keys(decl.bindings)).toHaveLength(35);
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
        const byField = new Map(
            items.flatMap((i) => (i.attributes ?? []).map(
                (a) => [`${i.id} ${a.id}`, new Set(a.choices ?? [])] as const,
            )),
        );
        let checked = 0;
        for (const [field, boxes] of boxesByField) {
            const source = decl.bindings[field];
            expect(source, `${field} has boxes on the page and no binding`).toBeDefined();
            expect(source.from, field).toBe('item_attribute');
            if (source.from !== 'item_attribute') continue;
            const stored = byField.get(`${source.itemId} ${source.attribute}`);
            expect([...(stored ?? [])].sort(), field).toEqual([...boxes].sort());
            checked += 1;
        }
        // Zero would satisfy every assertion above vacuously. Counted on the
        // form: six choice questions in each of two roof columns.
        expect(checked).toBe(12);
    });

    it('carries no rating system, because this form has no single judgement axis', () => {
        // Twelve questions, fourteen values, no axis they share. One rating
        // system per question would be the mechanism used backwards.
        expect(schema.ratingSystem).toBeUndefined();
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

    it('supplies the dated half of what the form REQUIRES, and routes the mark separately', () => {
        // `requiredFields` is [inspector_signature, inspector_signature_date].
        // The date is now an ordinary `from: 'inspection'` binding and emits a
        // key like any other; the signature deliberately emits NONE, because a
        // mark resolves by reference in the produce service and must never
        // travel through this object. So exactly one of the two is missing here,
        // and that one is supplied to the renderer through `signatures`.
        expect([...fieldMap.requiredFields].sort())
            .toEqual(['inspector_signature', 'inspector_signature_date']);
        const values = collectStatutoryValues(decl, schema, {}, {
            client_name: 'A', client_email: null, client_phone: null,
            property_address: 'B', property_city: null, property_state: null,
            property_zip: null, inspection_date: '08/27/2026', inspector_name: 'C',
            inspector_license: 'D', company_name: 'E', company_phone: 'F',
            inspector_license_type: null, inspector_qualification: null,
            inspector_signature_date: null,
            owner_name: null, owner_email: null, owner_mailing_address: null,
            owner_home_phone: null, owner_work_phone: null, owner_cell_phone: null,
            employee_printed_name: null,
        }, {});
        const missing = fieldMap.requiredFields.filter((f) => !(f in values));
        expect(missing).toEqual(['inspector_signature']);
        // Both numbers. 35 bindings less the signature, which resolves by
        // reference and emits none, is 34 keys — so 2 of the form's 36 blanks
        // reach the renderer with nothing at all: the signature, and
        // `inspector_title` from gaps.md §1, which is simply unbound.
        expect(Object.keys(values)).toHaveLength(34);
        expect([...formFields].filter((f) => !(f in values)).sort()).toEqual([
            'inspector_signature',
            'inspector_title',
        ]);
    });
});
