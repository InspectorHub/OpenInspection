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
