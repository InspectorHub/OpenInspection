import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { checkRateLimit } from '../lib/rate-limit';
import {
    CommentAssistSchema,
    AutoSummarySchema,
    CommentAssistResponseSchema,
    AutoSummaryResponseSchema,
    SuggestCommentSchema,
    SuggestCommentResponseSchema,
    CommentEditSchema,
    CommentEditResponseSchema,
    AiContentReviewSchema,
    AiContentReviewResponseSchema,
} from '../lib/validations/ai.schema';
import { recordContentReview } from '../lib/ai/content-review';
import { Errors } from '../lib/errors';
import { withMcpMetadata } from "../lib/route-metadata-standards";

/**
 * POST /api/ai/comment-assist
 * Assistance for rewriting rough notes.
 */
const commentAssistRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/comment-assist',
    tags: ["ai"],
    summary: "Create ai comment assist",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CommentAssistSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CommentAssistResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "createAiCommentAssist",
    description: "Auto-generated placeholder for createAiCommentAssist (POST /comment-assist, ai domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/ai/auto-summary
 * Generates a high-level summary of defects.
 */
const autoSummaryRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/auto-summary',
    tags: ["ai"],
    summary: "Create ai auto summary",
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AutoSummarySchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AutoSummaryResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration'),
                },
            },
            description: 'Success',
        },
    },
    operationId: "createAiAutoSummary",
    description: "Auto-generated placeholder for createAiAutoSummary (POST /auto-summary, ai domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

/**
 * POST /api/ai/suggest-comment
 * Returns 3 AI-generated professional comments for a specific inspection item.
 */
/**
 * POST /api/ai/comment/edit  (Spec 5B P2B)
 * Rewrites a single canned/custom inspection comment based on a free-form
 * inspector instruction (e.g. "shorten", "add NW corner detail"). Rate-limited
 * the same way as login + booking endpoints.
 */
const commentEditRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/comment/edit',
    tags: ["ai"],
    summary: 'Rewrite a canned comment with AI assistance',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: { content: { 'application/json': { schema: CommentEditSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: CommentEditResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Rewritten comment',
        },
    },
    operationId: "createAiCommentEdit",
    description: "Auto-generated placeholder for createAiCommentEdit (POST /comment/edit, ai domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

const suggestCommentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/suggest-comment',
    tags: ["ai"],
    summary: 'Suggest professional comments for a form item',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: {
            content: { 'application/json': { schema: SuggestCommentSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuggestCommentResponseSchema.describe('TODO describe schema field for the OpenInspection MCP integration') } },
            description: 'Suggestions',
        },
    },
    operationId: "createAiSuggestComment",
    description: "Auto-generated placeholder for createAiSuggestComment (POST /suggest-comment, ai domain). TODO: replace with a real description sourced from the handler."
}, { scopes: ['write'], tier: 'extended' }));

// Each handler returns the service result AS ITS `data`, rather than picking
// fields out of it. The service already shapes the payload — text/summary/
// rewritten/suggestions plus the `aiCallId` a content-review record cites — and
// a handler that re-listed those fields is exactly where the next field gets
// dropped on the way out.
/**
 * POST /api/ai/reviews
 *
 * Records that a person reviewed model-assisted text before publication (#61).
 * NOT "accept": counsel refused the reading that a user clicking confirm
 * absolves the platform, so the verb here and in every label is `review`.
 */
const contentReviewRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/reviews',
    tags: ["ai"],
    summary: 'Record a human review of AI-assisted content',
    middleware: [requireRole('owner', 'manager', 'inspector')] as const,
    request: {
        body: { content: { 'application/json': { schema: AiContentReviewSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: AiContentReviewResponseSchema } },
            description: 'The review is on file',
        },
    },
    operationId: "createAiContentReview",
    description: "Record that a named user reviewed the output of one AI call attached to one artifact. Idempotent on (person, artifact, call): a retry is a no-op, and a second REVIEWER is a second row rather than a duplicate.",
}, { scopes: ['write'], tier: 'extended' }));

const aiRoutes = createApiRouter()
    .openapi(commentAssistRoute, async (c) => {
        const { text, context } = c.req.valid('json');
        const service = c.var.services.ai;

        const data = await service.generateProfessionalComment(text, context);
        return c.json({ success: true, data }, 200);
    })
    .openapi(autoSummaryRoute, async (c) => {
        const { inspectionId } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.ai;

        const data = await service.generateInspectionSummary(tenantId, inspectionId);
        return c.json({ success: true, data }, 200);
    })
    .openapi(commentEditRoute, async (c) => {
        await checkRateLimit(c, 'ai-comment-edit');
        const input = c.req.valid('json');
        // Strip undefined optional fields so service stays exactOptionalPropertyTypes-clean.
        const payload = {
            itemLabel:       input.itemLabel,
            sectionTitle:    input.sectionTitle,
            tab:             input.tab,
            originalComment: input.originalComment,
            instruction:     input.instruction,
            ...(input.category !== undefined ? { category: input.category } : {}),
            ...(input.location !== undefined ? { location: input.location } : {}),
        };
        const data = await c.var.services.ai.rewriteComment(payload);
        return c.json({ success: true, data }, 200);
    })
    .openapi(suggestCommentRoute, async (c) => {
        const params = c.req.valid('json');
        const data = await c.var.services.ai.suggestComment(params);
        return c.json({ success: true, data });
    })
    .openapi(contentReviewRoute, async (c) => {
        const body = c.req.valid('json');
        // The reviewer is WHOEVER IS AUTHENTICATED, never a field in the body.
        // A client-supplied reviewer id would let one account file a review in
        // another person's name, and naming the person IS the claim this row
        // exists to make.
        const reviewedBy = (c.get('user') as { sub?: string } | undefined)?.sub;
        if (!reviewedBy) throw Errors.Unauthorized('A review must name the person who made it.');
        await recordContentReview({
            db: c.env.DB,
            tenantId: c.get('tenantId'),
            artifactType: body.artifactType,
            artifactId: body.artifactId,
            reviewedBy,
            aiCallId: body.aiCallId,
        });
        return c.json({ success: true, data: { reviewed: true as const } }, 200);
    });

export type AiApi = typeof aiRoutes;

export default aiRoutes;
