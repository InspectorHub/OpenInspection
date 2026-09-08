/**
 * A template item may not promise a minimum photo count, because nothing
 * anywhere honours one.
 *
 * `minPhotos` was declared four times over — the client `ItemOptions`, the
 * server `ItemOptions`, the zod schema, and the form component's props — and
 * read by nothing. A template author could set "at least 3 photos" and the
 * product would neither enforce it, display it, nor mention it again. That is
 * the worse half of the dead-control taxonomy: not a button wired to nothing,
 * but a LABEL PROMISING A CAPABILITY THAT DOES NOT EXIST.
 *
 * WHY IT IS REMOVED RATHER THAN IMPLEMENTED. Surveyed 2026-09-08: Spectora's
 * own documentation says a template is "output exactly as entered" and that it
 * enforces nothing in code; what it and HomeGauge offer instead are DEFAULT
 * photos, which guarantee a photo is present without ever blocking anyone.
 * Neither ships a minimum-count rule. Building one would put a novel blocking
 * constraint in front of an inspector standing in a crawlspace who genuinely
 * cannot take the third picture — the field tool's job is to record what was
 * found, not to refuse the finding.
 *
 * REMOVING IT IS SAFE, and that was checked rather than assumed. Nothing in the
 * codebase ever WROTE the field: no editor input, no import adapter, no seeded
 * template, no built-in JSON. The local database agrees — of the templates
 * stored there, zero carry the key (the count of all templates was read in the
 * same query, so a zero from a broken query would have been visible).
 *
 * `ItemOptionsSchema` is `.strict()`, so this test is the removal's real
 * assertion: an author who sets it now gets a refusal instead of a setting that
 * is quietly ignored.
 */
import { describe, it, expect } from 'vitest';

import { TemplateSchemaV2Schema } from '../../../server/lib/validations/template.schema';

/** The smallest template the schema will accept, with one options-bearing item. */
function templateWithItemOptions(options: Record<string, unknown>) {
    return {
        schemaVersion: 2,
        sections: [
            {
                id: 'sec-1',
                title: 'Roof',
                items: [
                    { id: 'item-1', label: 'Covering', type: 'number', options },
                ],
            },
        ],
    };
}

/**
 * THE TYPE PROMISES A TEMPLATE THE VALIDATOR REFUSES.
 *
 * `TemplateSchemaV2` (the TypeScript interface) declares `structure`,
 * `sectionAssignments`, `itemAssignments` and `propertyMetadataFields` — the
 * multi-unit / multi-building shape. `TemplateSchemaV2Schema` (the zod
 * validator, `.strict()`) has never heard of any of them, so a template
 * carrying one cannot be saved, imported or read back. Nothing writes them,
 * which is why nobody had noticed; `inspection-resolvers.ts` READS
 * `structure?.buildings` and is itself listed as unreachable, which is what
 * being written for a payload that cannot exist looks like from the outside.
 *
 * This does not decide whether the multi-unit scope should be built. It makes
 * the drift LOUD: the next person to add a writer finds out here rather than
 * from a 400 in production, and if the scope is built the validator has to grow
 * these fields deliberately rather than by accident.
 */
describe('template schema type vs validator', () => {
    const REJECTED = ['structure', 'sectionAssignments', 'itemAssignments', 'propertyMetadataFields'];

    for (const field of REJECTED) {
        it(`refuses \`${field}\`, which the TypeScript type still declares`, () => {
            const base = templateWithItemOptions({});
            const result = TemplateSchemaV2Schema.safeParse({ ...base, [field]: {} });
            expect(result.success).toBe(false);
        });
    }

    // POSITIVE CONTROL: `.strict()` refuses any unknown key, so the four cases
    // above would pass against a validator that rejected everything. The
    // template they are added to must parse on its own.
    it('accepts the same template without them', () => {
        expect(TemplateSchemaV2Schema.safeParse(templateWithItemOptions({})).success).toBe(true);
    });
});

describe('template item options', () => {
    it('refuses a minimum photo count, which nothing would honour', () => {
        const result = TemplateSchemaV2Schema.safeParse(templateWithItemOptions({ minPhotos: 3 }));
        expect(result.success).toBe(false);
    });

    /**
     * POSITIVE CONTROL, and the one that matters most here.
     *
     * `.strict()` refuses any unknown key, so the case above would pass against
     * a schema that had never heard of item options at all — or against a
     * template shape this test simply built wrong. A neighbouring option must
     * still be accepted for the refusal to mean "this one, specifically".
     */
    it('still accepts the options beside it', () => {
        const result = TemplateSchemaV2Schema.safeParse(templateWithItemOptions({ min: 0, max: 10, unit: 'in' }));
        expect(result.success).toBe(true);
    });
});
