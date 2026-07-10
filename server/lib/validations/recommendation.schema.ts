import { z } from '@hono/zod-openapi';

// Module F (2026-07) — the single canonical severity vocabulary shared with
// rating levels (good | marginal | significant | minor). Mirrors
// rating-system.schema.ts's SeverityEnum; kept as a separate declaration
// here (recommendations is its own domain schema) rather than importing
// across domains.
export const SeverityEnum = z.enum(['good', 'marginal', 'significant', 'minor']);

export const CreateRecommendationSchema = z.object({
    category:             z.string().nullable().optional().describe('TODO describe category field for the OpenInspection MCP integration'),
    name:                 z.string().min(1).max(200).describe('TODO describe name field for the OpenInspection MCP integration'),
    severity:             SeverityEnum.describe('TODO describe severity field for the OpenInspection MCP integration'),
    defaultEstimateMin:   z.number().int().nonnegative().nullable().optional().describe('TODO describe defaultEstimateMin field for the OpenInspection MCP integration'),
    defaultEstimateMax:   z.number().int().nonnegative().nullable().optional().describe('TODO describe defaultEstimateMax field for the OpenInspection MCP integration'),
    defaultRepairSummary: z.string().min(1).max(2000).describe('TODO describe defaultRepairSummary field for the OpenInspection MCP integration'),
    recommendedContractorTypeId: z.string().nullable().optional().describe('Soft reference to contractor_types.id (no DB FK). Suggested contractor for this repair item.'),
}).openapi('CreateRecommendation');

export const UpdateRecommendationSchema = CreateRecommendationSchema.partial().openapi('UpdateRecommendation');

export const RecommendationSchema = z.object({
    id:                   z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId:             z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    category:             z.string().nullable().describe('TODO describe category field for the OpenInspection MCP integration'),
    name:                 z.string().describe('TODO describe name field for the OpenInspection MCP integration'),
    severity:             SeverityEnum.describe('TODO describe severity field for the OpenInspection MCP integration'),
    defaultEstimateMin:   z.number().int().nullable().describe('TODO describe defaultEstimateMin field for the OpenInspection MCP integration'),
    defaultEstimateMax:   z.number().int().nullable().describe('TODO describe defaultEstimateMax field for the OpenInspection MCP integration'),
    defaultRepairSummary: z.string().describe('TODO describe defaultRepairSummary field for the OpenInspection MCP integration'),
    recommendedContractorTypeId: z.string().nullable().describe('Soft reference to contractor_types.id; suggested contractor for this repair item.'),
    createdByUserId:      z.string().nullable().describe('TODO describe createdByUserId field for the OpenInspection MCP integration'),
    createdAt:            z.union([z.string(), z.date(), z.number()]).describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('Recommendation');

export const RecommendationResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    RecommendationSchema.describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('RecommendationResponse');

export const RecommendationListResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data:    z.array(RecommendationSchema).describe('TODO describe data field for the OpenInspection MCP integration'),
}).openapi('RecommendationListResponse');

export const ListRecommendationsQuerySchema = z.object({
    category: z.string().optional().describe('TODO describe category field for the OpenInspection MCP integration'),
    severity: SeverityEnum.optional().describe('TODO describe severity field for the OpenInspection MCP integration'),
}).openapi('ListRecommendationsQuery');

export const AttachedRecommendationItemSchema = z.object({
    recommendationId:    z.string().describe('TODO describe recommendationId field for the OpenInspection MCP integration'),
    estimateSnapshotMin: z.number().int().nullable().describe('TODO describe estimateSnapshotMin field for the OpenInspection MCP integration'),
    estimateSnapshotMax: z.number().int().nullable().describe('TODO describe estimateSnapshotMax field for the OpenInspection MCP integration'),
    summarySnapshot:     z.string().describe('TODO describe summarySnapshot field for the OpenInspection MCP integration'),
    contractorTypeSnapshot: z.string().nullable().describe('Contractor type name captured at attach time.'),
    attachedAt:          z.number().int().nonnegative().describe('TODO describe attachedAt field for the OpenInspection MCP integration'),
    itemId:              z.string().describe('TODO describe itemId field for the OpenInspection MCP integration'),
}).openapi('AttachedRecommendationItem');

export const AggregatedRecommendationsResponseSchema = z.object({
    success: z.literal(true).describe('TODO describe success field for the OpenInspection MCP integration'),
    data: z.object({
        items: z.array(AttachedRecommendationItemSchema).describe('TODO describe items field for the OpenInspection MCP integration'),
        totals: z.object({
            count:           z.number().int().nonnegative().describe('TODO describe count field for the OpenInspection MCP integration'),
            estimateMinSum:  z.number().int().nonnegative().describe('TODO describe estimateMinSum field for the OpenInspection MCP integration'),
            estimateMaxSum:  z.number().int().nonnegative().describe('TODO describe estimateMaxSum field for the OpenInspection MCP integration'),
        }).describe('TODO describe totals field for the OpenInspection MCP integration'),
    }),
}).openapi('AggregatedRecommendationsResponse');

export type CreateRecommendationInput = z.infer<typeof CreateRecommendationSchema>;
export type UpdateRecommendationInput = z.infer<typeof UpdateRecommendationSchema>;
