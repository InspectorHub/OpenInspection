import { z } from '@hono/zod-openapi';
import {
    MIGRATION_CONFLICT_POLICIES,
    MIGRATION_INTENTS,
    MIGRATION_ROW_RESOLUTIONS,
} from '../db/schema';
import {
    BUNDLE_CONTACT_TYPES,
    TEMPLATE_RATING_KINDS,
    VENDOR_IDS,
} from '../migration-intake/bundle';

/**
 * Request shapes for the import-run routes.
 *
 * Every schema here has a route behind it — an exported schema with none is a
 * claim about a surface that does not exist, and the dead-code gate is right to
 * call it one.
 */

/** Everything the upload form carries besides the file itself. */
export const IntakeUploadFormSchema = z.object({
    intent: z.enum(MIGRATION_INTENTS)
        .describe('Which entry point started this run, deciding what it may import'),
    targetId: z.string().min(1).optional()
        .describe('Id of the template this run replaces, for an overwrite import only'),
    // Deliberately a plain optional string rather than `z.literal('true')`.
    // The refusal for a missing agreement is a sentence the operator has to be
    // able to act on, and it belongs to the handler that knows what was being
    // agreed to — a schema rejection here would answer the same status code
    // with zod's wording and no way to tell the two guards apart.
    // OPTIONAL in the SCHEMA and required by the HANDLER, which is not a
    // contradiction: one entry point — the one for a file whose owner could
    // not name the product — has nothing to declare, and refusing it here
    // would close the only door built for not knowing. Every other intent is
    // refused by the handler with a sentence naming what is missing, which is
    // the distinction zod cannot express and the operator has to be able to
    // act on. What is gone is the DEFAULT: nothing derives a vendor any more.
    vendor: z.enum(VENDOR_IDS).optional()
        .describe('Which product the file was exported from, as the operator declared it'),
    uploadAuthorized: z.string().optional()
        .describe('Set to "true" to confirm the uploaded file may be kept so the run can be resumed'),
    staffAccessAuthorized: z.string().optional()
        .describe('Set to "true" to confirm a person may open the file if nothing here can read it'),
    file: z.unknown()
        .describe('The exported file being imported, carried as multipart form data'),
});

export const IntakeBatchParamsSchema = z.object({
    batchId: z.string().min(1).describe('Id of the import run being read or changed'),
}).openapi('IntakeBatchParams');

export const IntakeListQuerySchema = z.object({
    limit: z.coerce.number().int().min(1).max(100).optional()
        .describe('How many runs to return, newest first'),
}).openapi('IntakeListQuery');

export const IntakeReportQuerySchema = z.object({
    page: z.coerce.number().int().min(1).optional()
        .describe('Which page of entries needing attention to return'),
    pageSize: z.coerce.number().int().min(1).max(100).optional()
        .describe('How many entries needing attention per page'),
}).openapi('IntakeReportQuery');

export const IntakeRowParamsSchema = z.object({
    batchId: z.string().min(1).describe('Id of the import run the entry belongs to'),
    rowId: z.string().min(1).describe('Id of the prepared entry being corrected'),
}).openapi('IntakeRowParams');

/**
 * Where one field's value comes from: a column of the uploaded file, or one
 * answer given for the whole file.
 *
 * A union of two one-key objects rather than a nullable pair, because there is
 * no third shape. A required field with no source is an incomplete mapping, and
 * the adapter will refuse it — which is a different sentence from "you chose a
 * column that is not in this file".
 */
function valueSource<T extends z.ZodTypeAny>(fixed: T) {
    return z.union([
        z.object({ column: z.string().min(1).describe('Header of the column feeding this field') }).strict(),
        z.object({ fixed: fixed.describe('One answer applied to every entry') }).strict(),
    ]);
}

/**
 * A new column mapping for a run whose file is still stored.
 *
 * `kind` is carried in the body and CHECKED against the run's own entity family
 * in the repair service. It is not derived from the run, because a mapping that
 * describes members would otherwise be silently read as a contact mapping and
 * the operator would be told their columns are missing.
 */
export const RemapRequestSchema = z.object({
    mapping: z.union([
        z.object({
            kind: z.literal('template'),
            name: z.string().min(1).describe('Name the imported template is saved under'),
            ratingKind: z.enum(TEMPLATE_RATING_KINDS)
                .describe('What the template\'s own rating words mean, as the operator read them'),
        }).strict(),
        z.object({
            kind: z.literal('contacts'),
            mapping: z.object({
                name: z.string().min(1).describe('Column holding the contact name'),
                email: z.string().min(1).optional().describe('Column holding the email address'),
                phone: z.string().min(1).optional().describe('Column holding the phone number'),
                agency: z.string().min(1).optional().describe('Column holding the agency or company'),
                type: valueSource(z.enum(BUNDLE_CONTACT_TYPES))
                    .describe('Where each contact\'s type comes from'),
            }).strict(),
        }).strict(),
        z.object({
            kind: z.literal('members'),
            mapping: z.object({
                email: z.string().min(1).describe('Column holding the email address to invite'),
                name: z.string().min(1).optional().describe('Column holding the person\'s name'),
                role: valueSource(z.enum(['owner', 'manager', 'inspector']))
                    .describe('Where each invitation\'s role comes from'),
            }).strict(),
        }).strict(),
    ]).describe('Which column, or which fixed answer, feeds each field'),
}).openapi('RemapRequest');

/**
 * One corrected entry, whole.
 *
 * `unknown` rather than a per-entity shape: what a valid entry looks like is
 * settled by the run's own entity family, which the route does not read off the
 * request, and the repair service answers with what is STILL wrong rather than
 * refusing. A zod rejection here would replace that answer with a 400 the
 * operator cannot act on.
 */
export const RepairRowRequestSchema = z.object({
    payload: z.unknown().describe('The whole entry as it should now read'),
}).openapi('RepairRowRequest');

export const ApplyRequestSchema = z.object({
    conflictPolicy: z.enum(MIGRATION_CONFLICT_POLICIES)
        .describe('How an entry that clashes with something existing is settled'),
    rowResolutions: z.record(z.string(), z.enum(MIGRATION_ROW_RESOLUTIONS)).optional()
        .describe('Per-entry settlements, read only under the per_row policy; an unanswered entry keeps what is already there'),
}).openapi('ApplyRequest');

