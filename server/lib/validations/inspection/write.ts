import { z } from '@hono/zod-openapi';

/**
 * Validation schema for inspection results patch.
 */
export const PatchResultsSchema = z.object({
    data: z.record(z.string(), z.unknown()).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('PatchResults');

// -----------------------------------------------------------------------------
// Typed-Hono dead-routes cleanup Tasks 10–13 — results batch + conflicts.
// -----------------------------------------------------------------------------
// ResultsBatchSchema: vectorised form-renderer save. One `{ itemId, sectionId,
// field, value }` patch per dirty field — the service folds each patch into the
// shared inspection_results.data JSON blob using the same composite findingKey
// the single-item PATCH uses, so existing offline clients keep working.
export const ResultsBatchSchema = z.object({
    patches: z.array(z.object({
        itemId:    z.string().min(1).describe('Template item id the patch targets'),
        sectionId: z.string().min(1).describe('Section id the target item belongs to'),
        field:     z.enum(['rating', 'notes', 'value', 'canned', 'defectFields', 'itemAttribute']).describe('Which result field this patch updates'),
        value:     z.any().describe('New value to write for the field'),
    })).min(1).max(500).describe('Array of per-field result patches to apply'),
}).openapi('ResultsBatchRequest');

export const ResultsBatchResponseSchema = z.object({
    success: z.literal(true),
    data:    z.object({ applied: z.number().int().min(0) }),
}).openapi('ResultsBatchResponse');

// Conflicts pulled from the inspection_conflicts table (persisted at sync time
// by inspection-sync.ts mergeResults branch). field is open string (rather than
// the patch enum) so non-`notes` future conflict producers don't need a schema
// edit.
export const ConflictListResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        conflicts: z.array(z.object({
            id:        z.string(),
            itemId:    z.string(),
            sectionId: z.string().nullable(),
            field:     z.string(),
            base:      z.any(),
            local:     z.any(),
            remote:    z.any(),
            createdAt: z.string(),
        })),
    }),
}).openapi('ConflictListResponse');

export const ConflictResolveSchema = z.object({
    resolutions: z.array(z.object({
        itemId:    z.string().min(1).describe('Template item id of the conflicted field'),
        sectionId: z.string().nullable().optional().describe('Section id the conflicted item belongs to'),
        field:     z.string().min(1).describe('Name of the field whose conflict is resolved'),
        chosen:    z.enum(['local', 'remote', 'base']).describe('Which side the inspector chose to keep'),
    })).min(1).describe('Array of per-field conflict resolutions to clear'),
}).openapi('ConflictResolveRequest');

export const ConflictResolveResponseSchema = z.object({
    success: z.literal(true),
    data:    z.object({
        resolved:   z.number().int().min(0),
        resolvedAt: z.string(),
    }),
}).openapi('ConflictResolveResponse');
