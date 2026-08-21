/**
 * Runtime validation for MigrationBundleV1.
 *
 * Three rules are enforced here rather than left to adapter discipline,
 * because each of them replaces a failure that has been observed to pass
 * unnoticed:
 *
 *  1. No bundle may carry an id. Ids are minted on write.
 *  2. Per entity kind, `readFromSource === emitted + dropped.length`, and
 *     `emitted` equals the length of the array it counts. An entry that was
 *     lost has to be written down before the bundle validates.
 *  3. Every dropped entry is located and explained, never merely counted.
 */
import { z } from 'zod';
import {
    MIGRATION_ENTITY_KINDS,
    VENDOR_IDS,
    type EntityKind,
    type MigrationBundleV1,
} from '../migration-intake/bundle';
import { TemplateSchemaV2Schema } from './template.schema';

const droppedEntrySchema = z.object({
    /** A path into the source, e.g. `sections[3].items[7]`. */
    at: z.string().min(1),
    reason: z.string().min(1),
});

const entityCountsSchema = z.object({
    readFromSource: z.number().int().min(0),
    emitted: z.number().int().min(0),
    dropped: z.array(droppedEntrySchema),
});

const bundleWarningSchema = z.object({
    code: z.string().min(1),
    message: z.string().min(1),
});

/**
 * `.strict()` everywhere an entity is described: an unexpected key is how a
 * vendor identifier reaches a writer that was never asked to consider one.
 */
const bundleTemplateSchema = z.object({
    // Empty is admitted for the same reason as an empty contact name: the
    // describer has a sentence for it, and the wizard's own default produces
    // one — the starting template name is the file name with its extension
    // removed, which is empty for a file called `.json`.
    //
    // The 100-character cap STAYS, and is the one refusal left here that no
    // row-level sentence explains. It is kept rather than relaxed because
    // admitting an unbounded name would put it in a staging payload and then in
    // a column, and the describer would need a sentence before either.
    name: z.string().max(100),
    schema: TemplateSchemaV2Schema,
    stats: z.object({
        sections: z.number().int().min(0),
        items: z.number().int().min(0),
        information: z.number().int().min(0),
        limitations: z.number().int().min(0),
        defects: z.number().int().min(0),
        unknownCommentTypes: z.array(z.string()),
    }),
}).strict();

/**
 * A ROW's own faults are not the FILE's faults.
 *
 * Every field below was once judged here and is now judged by
 * `describeRowProblem`, one row at a time, because judging them here voided the
 * whole upload: a single malformed address in a five-hundred-row spreadsheet
 * answered "that file is not a valid migration bundle" and named neither the
 * row nor the column. The likeliest cause of that address is not dirty data but
 * a mapping aimed at the wrong column — a mistake this refusal could not
 * describe and the mapping step could not be reached to correct.
 *
 * The permissiveness is bounded by exactly one rule: a value may be admitted
 * here only if the describer has a sentence for it. It has sentences for a
 * missing name, an address that is not one, a contact type outside our
 * vocabulary, a role outside the ones an import may grant, and the `agent` role
 * specifically. It has none for a wrong TYPE — a name that arrives as a number
 * cannot be explained to anybody — so the shapes stay.
 *
 * `.strict()` stays for the same reason it was added: an unexpected key is how
 * a vendor identifier reaches a writer that was never asked to consider one.
 */
const bundleContactSchema = z.object({
    name: z.string(),
    email: z.string().optional(),
    phone: z.string().optional(),
    agency: z.string().optional(),
    /**
     * Present but unjudged. The KEY is still required — a bundle that never
     * mentioned the type did not describe the row, whereas a bundle that says
     * "Buyer" described a row somebody can fix.
     */
    type: z.string(),
}).strict();

const bundleMemberSchema = z.object({
    /**
     * REQUIRED, and that has not changed. This is where the invitation goes;
     * a row that does not carry the field is a row no screen can repair,
     * whereas an empty or malformed one is a problem row with a sentence.
     */
    email: z.string(),
    name: z.string().optional(),
    role: z.string(),
    permissionOverrides: z.record(z.string(), z.boolean()).optional(),
}).strict();

const manifestSchema = z.object({
    source: z.object({
        vendor: z.enum(VENDOR_IDS),
        exportedAt: z.string().optional(),
    }).strict(),
    adapter: z.object({
        name: z.string().min(1),
        version: z.string().min(1),
    }).strict(),
    counts: z.object({
        template: entityCountsSchema,
        contact: entityCountsSchema,
        member: entityCountsSchema,
    }).strict(),
    warnings: z.array(bundleWarningSchema),
}).strict();

const ARRAY_FOR_KIND: Record<EntityKind, 'templates' | 'contacts' | 'members'> = {
    template: 'templates',
    contact: 'contacts',
    member: 'members',
};

const MigrationBundleV1Schema = z.object({
    formatVersion: z.literal(1),
    manifest: manifestSchema,
    templates: z.array(bundleTemplateSchema),
    contacts: z.array(bundleContactSchema),
    members: z.array(bundleMemberSchema),
}).strict().superRefine((bundle, ctx) => {
    for (const kind of MIGRATION_ENTITY_KINDS) {
        const counts = bundle.manifest.counts[kind];
        const arrayKey = ARRAY_FOR_KIND[kind];
        const actual = bundle[arrayKey].length;

        if (counts.readFromSource !== counts.emitted + counts.dropped.length) {
            ctx.addIssue({
                code: 'custom',
                path: ['manifest', 'counts', kind],
                message:
                    `${kind}: readFromSource (${counts.readFromSource}) must equal emitted ` +
                    `(${counts.emitted}) plus dropped (${counts.dropped.length}). ` +
                    `An entry that was not emitted has to be named in dropped.`,
            });
        }

        if (counts.emitted !== actual) {
            ctx.addIssue({
                code: 'custom',
                path: ['manifest', 'counts', kind, 'emitted'],
                message: `${kind}: emitted (${counts.emitted}) disagrees with ${arrayKey}.length (${actual}).`,
            });
        }
    }
});

/**
 * Parse an untrusted payload into a bundle.
 *
 * Returns issues as flat sentences rather than a zod tree: the caller is the
 * staging step, whose job is to tell an operator what is wrong with the file
 * they uploaded.
 */
export function parseMigrationBundle(
    input: unknown,
): { ok: true; bundle: MigrationBundleV1 } | { ok: false; issues: string[] } {
    const parsed = MigrationBundleV1Schema.safeParse(input);
    if (parsed.success) return { ok: true, bundle: parsed.data as MigrationBundleV1 };
    return {
        ok: false,
        issues: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`),
    };
}
