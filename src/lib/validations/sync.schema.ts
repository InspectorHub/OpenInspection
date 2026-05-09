import { z } from '@hono/zod-openapi';

const AttachedRecommendationSchema = z.object({
    recommendationId:    z.string(),
    estimateSnapshotMin: z.number().nullable(),
    estimateSnapshotMax: z.number().nullable(),
    summarySnapshot:     z.string(),
    attachedAt:          z.number().int().nonnegative(),
});

const ItemResultSchema = z.object({
    status: z.string().nullable(),
    notes:  z.string(),
    photos: z.array(z.object({
        key: z.string(),
        annotatedKey:    z.string().optional(),
        annotationsJson: z.string().optional(),
    })),
    updatedAt:       z.number().int().nonnegative(),
    recommendations: z.array(AttachedRecommendationSchema).optional(),
});

export const ResultsBlobSchema = z.record(z.string(), ItemResultSchema).openapi('ResultsBlob');

/**
 * Iter-2 bug #11 — dirty-field map narrows the conflict surface.
 *
 * Shape: `{ [itemId]: ['notes','status','photos','recommendations'] }`.
 * Only listed (itemId, field) pairs contribute to a conflict — every
 * other field silently takes theirs so server-only writes (e.g. an admin
 * toggling `paymentRequired` from another tab, or a third-party adding
 * an agreement signature) cannot pop a conflict modal at the inspector.
 *
 * Optional for backwards-compat: callers that omit the field fall back
 * to the pre-bug-#11 "compare every field" behaviour so older clients
 * that haven't shipped the new sync engine still merge correctly.
 */
const ItemDirtyFieldsSchema = z.array(z.enum(['status', 'notes', 'photos', 'recommendations']));
export const DirtyFieldsMapSchema = z.record(z.string(), ItemDirtyFieldsSchema).openapi('DirtyFieldsMap');

export const ResultsMergeRequestSchema = z.object({
    baseSyncedAt: z.number().int().nonnegative(),
    base:         ResultsBlobSchema, // client's last server-confirmed snapshot — needed because server doesn't keep history
    ours:         ResultsBlobSchema,
    dirtyFields:  DirtyFieldsMapSchema.optional(),
}).openapi('ResultsMergeRequest');

export const MergeConflictSchema = z.object({
    itemId: z.string(),
    field:  z.literal('notes'),
    base:   z.string(),
    ours:   z.string(),
    theirs: z.string(),
}).openapi('MergeConflict');

export const ResultsMergeResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        merged:    ResultsBlobSchema,
        syncedAt:  z.number().int().nonnegative(),
        conflicts: z.array(MergeConflictSchema),
    }),
}).openapi('ResultsMergeResponse');

export const InspectorSignatureSchema = z.object({
    signatureBase64: z.string().min(100).max(500_000),
    signedAt:        z.number().int().positive(),
}).openapi('InspectorSignature');
