import { z } from 'zod';
import { TemplateSchemaV2Schema } from './template.schema';

/**
 * The v2 template schema, plus the one key the tenant-facing schema refuses.
 *
 * ⚠️ USED BY EXACTLY ONE CALLER: the `kind === 'statutory'` branch of the
 * catalogue import. It is safe there and only there, because the catalogue is
 * written by the seeder alone — a fact `lint:catalogue-writes` exists to keep
 * true. If that gate is ever removed, this schema becomes a door anyone can
 * walk through, and the thing on the other side of it is a template that claims
 * to produce an authority's own form.
 *
 * ⚠️ THIS IS NOT THE TENANT-FACING SCHEMA AND MUST NEVER BECOME IT.
 * `TemplateSchemaV2Schema` stays `.strict()` without `statutoryForm`, which is
 * what stops a workspace declaring its own official form on a template it
 * authors. Adding the key there would not be a loosened validator; it would be
 * a decision that workspaces may publish statutory forms.
 *
 * A separate schema rather than a boolean on the existing validator: a flag
 * that switches off a door is one call site away from being passed by something
 * that should not have it, and the flag's default is the only thing standing
 * between the two.
 *
 * It stays `.strict()` about everything else. This admits one key; it does not
 * turn validation off.
 */
export const StatutoryFormDeclarationSchema = z.object({
    /** The form, not the revision — the revision is chosen by inspection date. */
    formId: z.string().min(1),
    /**
     * Form field name -> where its value comes from.
     *
     * Checked for SHAPE only. The value side is `StatutoryValueSource`, a closed
     * discriminated union in `server/types/statutory-declaration.ts`, and the
     * authority on whether a binding is usable is the field map that ships with
     * the software and goes through code review — not this parse. Restating that
     * union here would create a second place for it to be wrong.
     */
    bindings: z.record(z.string(), z.unknown()),
    /** Repeated blocks. Absent when the form has none. */
    groups: z.array(z.unknown()).optional(),
}).strict();

export const StatutoryTemplateSchema = TemplateSchemaV2Schema
    .extend({ statutoryForm: StatutoryFormDeclarationSchema })
    .strict();
