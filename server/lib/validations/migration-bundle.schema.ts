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
    BUNDLE_CONTACT_TYPES,
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
    name: z.string().min(1).max(100),
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

const bundleContactSchema = z.object({
    name: z.string().min(1),
    email: z.string().email().optional(),
    phone: z.string().optional(),
    agency: z.string().optional(),
    type: z.enum(BUNDLE_CONTACT_TYPES),
}).strict();

const bundleMemberSchema = z.object({
    email: z.string().email(),
    name: z.string().optional(),
    role: z.enum(['owner', 'manager', 'inspector']),
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

export const MigrationBundleV1Schema = z.object({
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
