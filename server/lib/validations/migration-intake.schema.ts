import { z } from '@hono/zod-openapi';
import { MIGRATION_INTENTS } from '../db/schema';

/**
 * Request shapes for the import-run routes.
 *
 * Only the three the read/create half actually mounts live here today. The
 * mapping, repair and apply bodies arrive with the routes that consume them —
 * an exported schema with no route behind it is a claim about a surface that
 * does not exist yet, and the dead-code gate is right to call it one.
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
