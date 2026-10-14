import { z } from '@hono/zod-openapi';

// Module F (2026-07) — the single canonical severity vocabulary shared with
// rating levels (good | marginal | significant | minor). Mirrors
// rating-system.schema.ts's SeverityEnum; kept as a separate declaration
// here (recommendations is its own domain schema) rather than importing
// across domains.
const SeverityEnum = z.enum(['good', 'marginal', 'significant', 'minor']);

export const CreateRecommendationSchema = z.object({
    category:             z.string().nullable().optional().describe('Recommendation category, or null.'),
    name:                 z.string().min(1).max(200).describe('Recommendation name.'),
    severity:             SeverityEnum.describe('Severity class of the recommendation.'),
    defaultRepairSummary: z.string().min(1).max(2000).describe('Scope of the repair. A repair item carries scope, never a price.'),
    recommendedContractorTypeId: z.string().nullable().optional().describe('Soft reference to contractor_types.id (no DB FK). Suggested contractor for this repair item.'),
}).openapi('CreateRecommendation');

export const UpdateRecommendationSchema = CreateRecommendationSchema.partial().openapi('UpdateRecommendation');

const RecommendationSchema = z.object({
    id:                   z.string().trim().min(1).describe('Recommendation id.'),
    tenantId:             z.string().trim().min(1).describe('Id of the company that owns the recommendation.'),
    category:             z.string().nullable().describe('Recommendation category, or null.'),
    name:                 z.string().describe('Recommendation name.'),
    severity:             SeverityEnum.describe('Severity class of the recommendation.'),
    defaultRepairSummary: z.string().describe('Scope of the repair. A repair item carries scope, never a price.'),
    recommendedContractorTypeId: z.string().nullable().describe('Soft reference to contractor_types.id; suggested contractor for this repair item.'),
    createdByUserId:      z.string().nullable().describe('User who created the recommendation, or null for seeded entries.'),
    createdAt:            z.union([z.string(), z.date(), z.number()]).describe('When the recommendation was created.'),
}).openapi('Recommendation');

export const RecommendationResponseSchema = z.object({
    success: z.literal(true).describe('True when the request succeeded.'),
    data:    RecommendationSchema.describe('Recommendation payload.'),
}).openapi('RecommendationResponse');

export const RecommendationListResponseSchema = z.object({
    success: z.literal(true).describe('True when the request succeeded.'),
    data:    z.array(RecommendationSchema).describe('Recommendation payload.'),
}).openapi('RecommendationListResponse');

export const ListRecommendationsQuerySchema = z.object({
    category: z.string().optional().describe('Return only recommendations in this category.'),
    severity: SeverityEnum.optional().describe('Return only recommendations of this severity.'),
}).openapi('ListRecommendationsQuery');

export const AttachedRecommendationItemSchema = z.object({
    recommendationId:    z.string(),
    estimateSnapshotMin: z.number().int().nullable(),
    estimateSnapshotMax: z.number().int().nullable(),
    summarySnapshot:     z.string(),
    contractorTypeSnapshot: z.string().nullable().describe('Contractor type name captured at attach time.'),
    attachedAt:          z.number().int().nonnegative(),
    itemId:              z.string(),
}).openapi('AttachedRecommendationItem');

export const AggregatedRecommendationsResponseSchema = z.object({
    success: z.literal(true),
    data: z.object({
        items: z.array(AttachedRecommendationItemSchema),
        totals: z.object({
            count:           z.number().int().nonnegative(),
            estimateMinSum:  z.number().int().nonnegative(),
            estimateMaxSum:  z.number().int().nonnegative(),
        }),
    }),
}).openapi('AggregatedRecommendationsResponse');

