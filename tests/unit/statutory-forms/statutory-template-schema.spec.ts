import { describe, it, expect } from 'vitest';
import { StatutoryFormDeclarationSchema } from '../../../server/lib/validations/statutory-template.schema';

/**
 * What a platform-supplied statutory declaration may carry through validation.
 *
 * -- WHY THIS SPEC EXISTS ----------------------------------------------------
 * `dependsOn` was added to `StatutoryFormDeclaration` in one commit and to this
 * `.strict()` schema in none. Nothing went red: no published form used it yet,
 * so the only observable symptom would have arrived the day a Florida form
 * reached catalogue install and was refused with "Unrecognized key".
 *
 * A key on the type and not on the schema is a seam between two files that no
 * compiler spans. These assertions span it, in the only direction that matters:
 * every optional key the type declares must PARSE, and everything else must
 * still be refused -- because a fix that simply dropped `.strict()` would
 * satisfy the first half and hand workspaces a door.
 */
const BASE = { formId: 'tx_trec_rei', bindings: {}, revision: 'REI 7-6' };

describe('StatutoryFormDeclarationSchema', () => {
    it('accepts a declaration with nothing optional on it', () => {
        expect(StatutoryFormDeclarationSchema.safeParse(BASE).success).toBe(true);
    });

    it('accepts `dependsOn`, including the keys nested inside a rule', () => {
        // Shape only, exactly as `bindings` is. The authority on whether a rule
        // is usable is the field map that goes through code review.
        const parsed = StatutoryFormDeclarationSchema.safeParse({
            ...BASE,
            dependsOn: {
                roof_wall_attachment_minimal_condition: {
                    field: 'roof_wall_attachment',
                    answerIsOneOf: ['B', 'C', 'D'],
                    labelSeparator: '.',
                },
            },
        });
        expect(parsed.success).toBe(true);
    });

    it('still refuses a key nobody declared', () => {
        // THE POSITIVE CONTROL. Dropping `.strict()` would make the assertion
        // above pass and would also let a workspace-authored template carry
        // anything at all -- and this schema's own header says that door is the
        // whole reason it is separate from the tenant-facing one.
        const parsed = StatutoryFormDeclarationSchema.safeParse({ ...BASE, totallyMadeUp: 1 });
        expect(parsed.success).toBe(false);
    });

    it('refuses a rule key hoisted to the top level, where it means nothing', () => {
        // `labelSeparator` belongs to ONE dependency rule. At the declaration's
        // top level it would read as a form-wide setting that nothing consumes.
        expect(StatutoryFormDeclarationSchema.safeParse({ ...BASE, labelSeparator: '.' }).success)
            .toBe(false);
    });
});
