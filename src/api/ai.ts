import { OpenAPIHono, createRoute } from '@hono/zod-openapi';
import { HonoConfig } from '../types/hono';
import { requireRole } from '../lib/middleware/rbac';
import {
    CommentAssistSchema,
    AutoSummarySchema,
    CommentAssistResponseSchema,
    AutoSummaryResponseSchema,
    SuggestCommentSchema,
    SuggestCommentResponseSchema,
} from '../lib/validations/ai.schema';

const aiRoutes = new OpenAPIHono<HonoConfig>();

/**
 * POST /api/ai/comment-assist
 * Assistance for rewriting rough notes.
 */
const commentAssistRoute = createRoute({
    method: 'post',
    path: '/comment-assist',
    tags: ['AI'],
    summary: 'Professional comment assistant',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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
});

aiRoutes.openapi(commentAssistRoute, async (c) => {
    const { text, context } = c.req.valid('json');
    const service = c.var.services.ai;
    
    const professionalText = await service.generateProfessionalComment(text, context);
    return c.json({ success: true, data: { text: professionalText } }, 200);
});

/**
 * POST /api/ai/auto-summary
 * Generates a high-level summary of defects.
 */
const autoSummaryRoute = createRoute({
    method: 'post',
    path: '/auto-summary',
    tags: ['AI'],
    summary: 'Generate inspection summary',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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
});

aiRoutes.openapi(autoSummaryRoute, async (c) => {
    const { inspectionId } = c.req.valid('json');
    const tenantId = c.get('tenantId');
    const service = c.var.services.ai;
    
    const summary = await service.generateInspectionSummary(tenantId, inspectionId);
    return c.json({ success: true, data: { summary } }, 200);
});

/**
 * POST /api/ai/suggest-comment
 * Returns 3 AI-generated professional comments for a specific inspection item.
 */
aiRoutes.openapi(createRoute({
    method: 'post',
    path: '/suggest-comment',
    tags: ['AI'],
    summary: 'Suggest professional comments for a form item',
    middleware: [requireRole(['owner', 'admin', 'inspector'])] as const,
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
}), async (c) => {
    const params = c.req.valid('json');
    const suggestions = await c.var.services.ai.suggestComment(params);
    return c.json({ success: true, data: suggestions });
});

export default aiRoutes;
