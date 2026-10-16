import { createRoute } from '@hono/zod-openapi';
import { createApiRouter } from '../lib/openapi-router';
import { requireRole } from '../lib/middleware/rbac';
import { requireCapability } from '../lib/middleware/require-capability';
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
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('editReports')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: CommentAssistSchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: CommentAssistResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "createAiCommentAssist",
    description: "Rewrite a rough inspector note as clear report prose. Returns the rewritten text and the id of the AI call record that produced it. Requires the editReports capability; office staff do not have it by default."
}, { scopes: ['write'], tier: 'extended', capability: 'editReports' }));

/**
 * POST /api/ai/auto-summary
 * Generates a high-level summary of defects.
 */
const autoSummaryRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/auto-summary',
    tags: ["ai"],
    summary: "Create ai auto summary",
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('editReports')] as const,
    request: {
        body: {
            content: {
                'application/json': {
                    schema: AutoSummarySchema,
                },
            },
        },
    },
    responses: {
        200: {
            content: {
                'application/json': {
                    schema: AutoSummaryResponseSchema,
                },
            },
            description: 'Success',
        },
    },
    operationId: "createAiAutoSummary",
    description: "Generate a short summary of an inspection's defects with the configured AI provider. Only the  Requires the editReports capability; office staff do not have it by default."
        + "inspector's notes on items rated Defect are sent to the model (an item with no note is sent as 'No "
        + "description provided'); item names, addresses and client details are not. When the inspection has no "
        + "results or no defects, a fixed 'no significant defects' sentence is returned without calling the model "
        + "and aiCallId is null. Otherwise aiCallId identifies the recorded AI call, which a human review can cite. "
        + "The inspection must belong to this company. Fails when AI is not configured or the workspace's AI "
        + "allowance is spent. Nothing is saved to the inspection, and each call is a fresh model call. Open to "
        + "owners, managers and inspectors."
}, { scopes: ['write'], tier: 'extended', capability: 'editReports' }));

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
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('editReports')] as const,
    request: {
        body: { content: { 'application/json': { schema: CommentEditSchema } } },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: CommentEditResponseSchema } },
            description: 'Rewritten comment',
        },
    },
    operationId: "createAiCommentEdit",
    description: "Rewrite one inspection comment according to a free-form instruction (for example shorten it, or add  Requires the editReports capability; office staff do not have it by default."
        + "location detail), using the item, section and tab it belongs to as context. Returns the rewritten text "
        + "and the id of the AI call that produced it, which is null only for the local development mock. Nothing is "
        + "saved: the caller decides whether to replace the original. Fails when AI is not configured, and is "
        + "rate-limited per caller. Each call is a fresh model call. Open to owners, managers and inspectors."
}, { scopes: ['write'], tier: 'extended', capability: 'editReports' }));

const suggestCommentRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/suggest-comment',
    tags: ["ai"],
    summary: 'Suggest professional comments for a form item',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('editReports')] as const,
    request: {
        body: {
            content: { 'application/json': { schema: SuggestCommentSchema } },
        },
    },
    responses: {
        200: {
            content: { 'application/json': { schema: SuggestCommentResponseSchema } },
            description: 'Suggestions',
        },
    },
    operationId: "createAiSuggestComment",
    description: "Ask the AI provider for up to three suggested report comments for one inspection item, given its  Requires the editReports capability; office staff do not have it by default."
        + "name, section and optionally its rating, the year built and the square footage. Returns the suggestions "
        + "as text plus the id of the AI call. If the model's answer cannot be read, or the model call fails, the "
        + "result is an empty suggestion list rather than an error; a missing AI configuration or a spent AI "
        + "allowance is still an error. Nothing is saved. Open to owners, managers and inspectors."
}, { scopes: ['write'], tier: 'extended', capability: 'editReports' }));

// Each handler returns the service result AS ITS `data`, rather than picking
// fields out of it. The service already shapes the payload — text/summary/
// rewritten/suggestions plus the `aiCallId` a content-review record cites — and
// a handler that re-listed those fields is exactly where the next field gets
// dropped on the way out.
/**
 * POST /api/ai/reviews
 *
 * Records that a person reviewed model-assisted text before publication (#61).
 * NOT "accept": a user clicking confirm does not absolve the platform, so the
 * verb here and in every label is `review`.
 */
const contentReviewRoute = createRoute(withMcpMetadata({
    method: 'post',
    path: '/reviews',
    tags: ["ai"],
    summary: 'Record a human review of AI-assisted content',
    middleware: [requireRole('owner', 'manager', 'inspector'), requireCapability('editReports')] as const,
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
    description: "Record that a named user reviewed the output of one AI call attached to one artifact. Idempotent on (person, artifact, call): a retry is a no-op, and a second REVIEWER is a second row rather than a duplicate. Requires the editReports capability; office staff do not have it by default.",
}, { scopes: ['write'], tier: 'extended', capability: 'editReports' }));

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
        const input = c.req.valid('json');
        // Same strip as rewriteComment above. `SuggestCommentPromptArgs` declares
        // rating/yearBuilt/sqft as ABSENT-able, and the prompt renderer tests them
        // for truthiness — so an omitted field and an explicitly-undefined one
        // produce the identical prompt. Build the argument without the keys the
        // caller did not send rather than widening the prompt contract.
        const params = {
            itemName:    input.itemName,
            sectionName: input.sectionName,
            ...(input.rating    !== undefined ? { rating:    input.rating }    : {}),
            ...(input.yearBuilt !== undefined ? { yearBuilt: input.yearBuilt } : {}),
            ...(input.sqft      !== undefined ? { sqft:      input.sqft }      : {}),
        };
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
