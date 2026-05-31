import { z } from '@hono/zod-openapi';

const AttachedRecommendationSchema = z.object({
    recommendationId:    z.string().describe('TODO describe recommendationId field for the OpenInspection MCP integration'),
    estimateSnapshotMin: z.number().nullable().describe('TODO describe estimateSnapshotMin field for the OpenInspection MCP integration'),
    estimateSnapshotMax: z.number().nullable().describe('TODO describe estimateSnapshotMax field for the OpenInspection MCP integration'),
    summarySnapshot:     z.string().describe('TODO describe summarySnapshot field for the OpenInspection MCP integration'),
    attachedAt:          z.number().int().nonnegative().describe('TODO describe attachedAt field for the OpenInspection MCP integration'),
});

const ItemResultSchema = z.object({
    status: z.string().nullable().describe('TODO describe status field for the OpenInspection MCP integration'),
    notes:  z.string().describe('TODO describe notes field for the OpenInspection MCP integration'),
    photos: z.array(z.object({
        key: z.string().describe('TODO describe key field for the OpenInspection MCP integration'),
        annotatedKey:    z.string().optional().describe('TODO describe annotatedKey field for the OpenInspection MCP integration'),
        annotationsJson: z.string().optional().describe('TODO describe annotationsJson field for the OpenInspection MCP integration'),
    })).describe('TODO describe photos field for the OpenInspection MCP integration'),
    updatedAt:       z.number().int().nonnegative().describe('TODO describe updatedAt field for the OpenInspection MCP integration'),
    recommendations: z.array(AttachedRecommendationSchema).optional().describe('TODO describe recommendations field for the OpenInspection MCP integration'),
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
    baseSyncedAt: z.number().int().nonnegative().describe('TODO describe baseSyncedAt field for the OpenInspection MCP integration'),
    base:         ResultsBlobSchema.describe('TODO describe base field for the OpenInspection MCP integration'), // client's last server-confirmed snapshot — needed because server doesn't keep history
    ours:         ResultsBlobSchema.describe('TODO describe ours field for the OpenInspection MCP integration'),
    dirtyFields:  DirtyFieldsMapSchema.optional().describe('TODO describe dirtyFields field for the OpenInspection MCP integration'),
}).openapi('ResultsMergeRequest');

export const MergeConflictSchema = z.object({
    itemId: z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
    field:  z.literal('notes').describe('TODO describe field field for the OpenInspection MCP integration'),
    base:   z.string().describe('TODO describe base field for the OpenInspection MCP integration'),
    ours:   z.string().describe('TODO describe ours field for the OpenInspection MCP integration'),
    theirs: z.string().describe('TODO describe theirs field for the OpenInspection MCP integration'),
}).openapi('MergeConflict');

export const ResultsMergeResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        merged:    ResultsBlobSchema.describe('TODO describe merged field for the OpenInspection MCP integration'),
        syncedAt:  z.number().int().nonnegative().describe('TODO describe syncedAt field for the OpenInspection MCP integration'),
        conflicts: z.array(MergeConflictSchema).describe('TODO describe conflicts field for the OpenInspection MCP integration'),
    }).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('ResultsMergeResponse');

export const InspectorSignatureSchema = z.object({
    signatureBase64: z.string().min(100).max(500_000).describe('TODO describe signatureBase64 field for the OpenInspection MCP integration'),
    signedAt:        z.number().int().positive().describe('TODO describe signedAt field for the OpenInspection MCP integration'),
}).openapi('InspectorSignature');
