import { z } from '@hono/zod-openapi';

// Spec 2026-05-07 — Comments Library unification.
// `severity` aligns user snippets with the seeded 250-entry library so both
// surfaces (the /comments page and the inspection-edit Library drawer)
// classify entries identically. `section` is free-text so tenants can grow
// their own taxonomy alongside the seeded sections (Roof / Electrical / …).
//
// Module F (2026-07) — the single canonical severity vocabulary shared with
// rating levels (`good | marginal | significant | minor`; see
// app/lib/severity.ts / rating-system.schema.ts's SeverityEnum). Retires the
// legacy `ratingBucket` (satisfactory | monitor | defect) write/read path —
// `comments.rating_bucket` is FROZEN (schema/inspection/comments.ts).
const SeverityFieldSchema = z.enum(['good', 'marginal', 'significant', 'minor']);

export const CommentSchema = z.object({
    text: z.string().min(1).max(1000).openapi({ example: 'Evidence of previous repair was observed.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().max(50).optional().nullable().openapi({ example: 'Roofing' }).describe('TODO describe category field for the OpenInspection MCP integration'),
    severity: SeverityFieldSchema.optional().nullable().openapi({ example: 'significant' }).describe('The single severity vocabulary shared with rating levels.'),
    section: z.string().max(64).optional().nullable().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    // Comments Library Upgrade — canonical single item label drives sort/filter.
    itemLabel: z.string().max(120).optional().nullable().openapi({ example: 'Roof Covering' }),
    repairSummary: z.string().max(2000).optional().nullable().describe('Repair recommendation summary (defect comments only).'),
    estimateMinCents: z.number().int().nonnegative().optional().nullable().describe('Low cost estimate in cents.'),
    estimateMaxCents: z.number().int().nonnegative().optional().nullable().describe('High cost estimate in cents.'),
    recommendedContractorTypeId: z.string().optional().nullable().describe('Soft ref to contractor_types.id.'),
}).openapi('Comment');

export const UpdateCommentSchema = z.object({
    text: z.string().min(1).max(1000).openapi({ example: 'Evidence of previous repair was observed.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().max(50).nullable().optional().openapi({ example: 'Roofing' }).describe('TODO describe category field for the OpenInspection MCP integration'),
    severity: SeverityFieldSchema.nullable().optional().openapi({ example: 'significant' }).describe('The single severity vocabulary shared with rating levels.'),
    section: z.string().max(64).nullable().optional().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    itemLabel: z.string().max(120).optional().nullable(),
    repairSummary: z.string().max(2000).optional().nullable().describe('Repair recommendation summary (defect comments only).'),
    estimateMinCents: z.number().int().nonnegative().optional().nullable().describe('Low cost estimate in cents.'),
    estimateMaxCents: z.number().int().nonnegative().optional().nullable().describe('High cost estimate in cents.'),
    recommendedContractorTypeId: z.string().optional().nullable().describe('Soft ref to contractor_types.id.'),
}).openapi('UpdateComment');

export const CommentResponseSchema = z.object({
    id: z.string().uuid().describe('TODO describe id field for the OpenInspection MCP integration'),
    tenantId: z.string().uuid().describe('TODO describe tenantId field for the OpenInspection MCP integration'),
    text: z.string().describe('TODO describe text field for the OpenInspection MCP integration'),
    category: z.string().nullable().describe('TODO describe category field for the OpenInspection MCP integration'),
    severity: SeverityFieldSchema.nullable().describe('The single severity vocabulary shared with rating levels.'),
    section: z.string().nullable().describe('TODO describe section field for the OpenInspection MCP integration'),
    itemLabel: z.string().nullable().optional(),
    repairSummary: z.string().nullable().optional(),
    estimateMinCents: z.number().int().nullable().optional(),
    estimateMaxCents: z.number().int().nullable().optional(),
    recommendedContractorTypeId: z.string().nullable().optional(),
    useCount: z.number().int().optional(),
    lastUsedAt: z.string().nullable().optional(),
    createdAt: z.string().describe('TODO describe createdAt field for the OpenInspection MCP integration'),
}).openapi('CommentResponse');

export const ListCommentsQuerySchema = z.object({
    severity: SeverityFieldSchema.optional().openapi({ example: 'significant' }).describe('Filter by the single severity vocabulary shared with rating levels.'),
    section: z.string().max(64).optional().openapi({ example: 'Roof' }).describe('TODO describe section field for the OpenInspection MCP integration'),
    sectionId: z.string().max(64).optional().openapi({ example: 'roof-general' }).describe('Filter by section ID (matches within the section_ids JSON array)'),
    triggerCode: z.string().max(64).optional().openapi({ example: 'NI' }).describe('Filter by trigger code'),
    search: z.string().max(200).optional().describe('TODO describe search field for the OpenInspection MCP integration'),
    // Comments Library Upgrade — new sort + filter mode + context filters.
    sort: z.enum(['relevance', 'recent', 'created', 'frequent', 'alpha']).optional().default('relevance').describe('Sort order for results: relevance, recent, created, frequent, or alpha'),
    filterMode: z.enum(['auto', 'all']).optional().default('all').describe('Filter mode: auto narrows to the inspection context, all shows everything'),
    itemLabel: z.string().max(120).optional().describe('Inspection item label used to narrow results when filterMode is auto'),
    // List Pagination PR — replace the old single-`limit` knob with shared
    // pagination params. page is 1-indexed; pageSize ∈ {12,25,50,100}, default 50.
    page: z.coerce.number().int().min(1).default(1).describe('1-indexed page number for paginated results'),
    pageSize: z.coerce.number().int()
        .refine((n) => [12, 25, 50, 100].includes(n), { message: 'pageSize must be one of 12, 25, 50, 100' })
        .default(50).describe('Number of results per page (one of 12, 25, 50, 100)'),
}).openapi('ListCommentsQuery');

export const CommentTouchResponseSchema = z.object({
    success: z.literal(true),
    data:    z.object({
        commentId: z.string(),
        useCount:  z.number().int(),
    }),
}).openapi('CommentTouchResponse');
