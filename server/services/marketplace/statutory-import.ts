/**
 * The `kind='statutory'` half of the catalogue import.
 *
 * The kind exists as its own branch rather than as a flavour of 'templates'
 * because of what is in this file: a statutory catalogue row carries a
 * declaration that the tenant-facing template schema refuses, and refusing it
 * there is the closed door that stops a workspace declaring its own official
 * form. The import for this one kind validates with the extended schema
 * instead — and nothing else in the codebase may.
 */
import { StatutoryTemplateSchema } from '../../lib/validations/statutory-template.schema';
import { Errors } from '../../lib/errors';

/**
 * Gate a `kind='statutory'` catalogue entry on the EXTENDED validator.
 *
 * ⚠️ THE ONLY CALLER OF `StatutoryTemplateSchema`, and it must stay that way.
 * A boolean on the ordinary validator would have done the same job and is
 * exactly what this avoids: a flag that switches off a door is one call site
 * away from being passed by something that should not have it.
 *
 * The relaxation is safe only because the catalogue is unreachable from user
 * input — every write to it is the seeder or a downloadCount increment, which
 * is what `lint:catalogue-writes` exists to keep true. If that gate is removed,
 * this stops being a validator and becomes a door.
 */
export function assertStatutorySchema(schema: unknown): void {
    // The column is `mode: 'json'`, but a row written as a JSON string reads
    // back as one — the same thing `TemplateService.validateSchema` handles.
    let parsed: unknown = schema;
    if (typeof parsed === 'string') {
        try {
            parsed = JSON.parse(parsed);
        } catch {
            throw Errors.BadRequest('Invalid statutory template: schema is not valid JSON');
        }
    }
    const result = StatutoryTemplateSchema.safeParse(parsed);
    if (!result.success) {
        const first = result.error.issues[0];
        const path = first?.path?.join('.') || 'schema';
        throw Errors.BadRequest(`Invalid statutory template: ${path} — ${first?.message ?? 'invalid'}`);
    }
}
