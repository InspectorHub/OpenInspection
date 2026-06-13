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
} from '../lib/validations/ai.schema';
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

export const aiRoutes = createApiRouter()
    .openapi(commentAssistRoute, async (c) => {
        const { text, context } = c.req.valid('json');
        const service = c.var.services.ai;

        const professionalText = await service.generateProfessionalComment(text, context);
        return c.json({ success: true, data: { text: professionalText } }, 200);
    })
    .openapi(autoSummaryRoute, async (c) => {
        const { inspectionId } = c.req.valid('json');
        const tenantId = c.get('tenantId');
        const service = c.var.services.ai;

        const summary = await service.generateInspectionSummary(tenantId, inspectionId);
        return c.json({ success: true, data: { summary } }, 200);
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
        const rewritten = await c.var.services.ai.rewriteComment(payload);
        return c.json({ success: true, data: { rewritten } }, 200);
    })
    .openapi(suggestCommentRoute, async (c) => {
        const params = c.req.valid('json');
        const suggestions = await c.var.services.ai.suggestComment(params);
        return c.json({ success: true, data: suggestions });
    });

export type AiApi = typeof aiRoutes;

export default aiRoutes;
