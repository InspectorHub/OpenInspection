import { z } from '@hono/zod-openapi';

// -----------------------------------------------------------------------------
// Results batch (bulk "Save").
// -----------------------------------------------------------------------------
// ResultsBatchSchema: vectorised bulk save. One `{ itemId, sectionId,
// field, value }` patch per dirty field — the service folds each patch into the
// shared inspection_results.data JSON blob using the same composite findingKey,
// with forced last-writer-wins per field (NOT the retired CAS version-check path).
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
