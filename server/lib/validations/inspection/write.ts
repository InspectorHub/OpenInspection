import { z } from '@hono/zod-openapi';

// -----------------------------------------------------------------------------
// Results batch (bulk "Save").
// -----------------------------------------------------------------------------
// ResultsBatchSchema: vectorised bulk save. One `{ itemId, sectionId,
// field, value }` patch per dirty field — the service folds each patch into the
// shared inspection_results.data JSON blob using the same composite findingKey,
// with forced last-writer-wins per field (NOT the retired CAS version-check path).
// `itemAttribute` is the one field whose value has a SHAPE, because an item
// carries many attributes and a patch has to name which one it answers. The
// service merges it onto `entry.attributes`; a whole-object write would erase
// every other answer on the same item. Refused here so a malformed payload is a
// 400 naming the field rather than a 500 out of the fold.
const ResultPatchSchema = z.object({
    itemId:    z.string().min(1).describe('Template item id the patch targets'),
    sectionId: z.string().min(1).describe('Section id the target item belongs to'),
    field:     z.enum(['rating', 'notes', 'value', 'canned', 'defectFields', 'itemAttribute']).describe('Which result field this patch updates'),
    value:     z.any().describe('New value to write for the field. For `itemAttribute` it must be { attributeId, value }.'),
}).superRefine((patch, ctx) => {
    if (patch.field !== 'itemAttribute') return;
    const v = patch.value as { attributeId?: unknown } | null;
    if (!v || typeof v !== 'object' || typeof v.attributeId !== 'string' || v.attributeId === '') {
        ctx.addIssue({
            code: 'custom',
            path: ['value'],
            message: 'an itemAttribute patch must carry { attributeId, value }',
        });
    }
});

export const ResultsBatchSchema = z.object({
    patches: z.array(ResultPatchSchema).min(1).max(500).describe('Array of per-field result patches to apply'),
}).openapi('ResultsBatchRequest');

export const ResultsBatchResponseSchema = z.object({
    success: z.literal(true),
    data:    z.object({ applied: z.number().int().min(0) }),
}).openapi('ResultsBatchResponse');
