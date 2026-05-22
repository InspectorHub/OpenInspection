import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Input for the comment assistance request.
 */
export const CommentAssistSchema = z.object({
    text: z.string().min(1, 'Text is required').openapi({ example: 'Roof is bad' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    context: z.string().optional().openapi({ example: 'Roof inspection' }).describe('TODO describe context field for the OpenInspection MCP integration'),
}).openapi('CommentAssistRequest');

/**
 * Input for the automatic summary request.
 */
export const AutoSummarySchema = z.object({
    inspectionId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
}).openapi('AutoSummaryRequest');

/**
 * Response for the comment assistance.
 */
export const CommentAssistResponseSchema = createApiResponseSchema(z.object({
    text: z.string().openapi({ example: 'The roof covering shows signs of significant wear and deterioration.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
})).openapi('CommentAssistResponse');

/**
 * Response for the automatic summary.
 */
export const AutoSummaryResponseSchema = createApiResponseSchema(z.object({
    summary: z.string().openapi({ example: 'The inspection revealed critical defects in the roofing and plumbing systems.' }).describe('TODO describe summary field for the OpenInspection MCP integration'),
})).openapi('AutoSummaryResponse');

/**
 * Input for the AI comment suggestion request.
 */
export const SuggestCommentSchema = z.object({
    itemName:        z.string().min(1).max(200).openapi({ example: 'Roof Covering' }).describe('TODO describe itemName field for the OpenInspection MCP integration'),
    sectionName:     z.string().min(1).max(200).openapi({ example: 'Roof' }).describe('TODO describe sectionName field for the OpenInspection MCP integration'),
    rating:          z.string().optional().openapi({ example: 'Defect' }).describe('TODO describe rating field for the OpenInspection MCP integration'),
    propertyAddress: z.string().optional().describe('TODO describe propertyAddress field for the OpenInspection MCP integration'),
    yearBuilt:       z.number().int().nullable().optional().describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
    sqft:            z.number().int().nullable().optional().describe('TODO describe sqft field for the OpenInspection MCP integration'),
}).openapi('SuggestCommentRequest');

/**
 * Response for the AI comment suggestion.
 */
export const SuggestCommentResponseSchema = createApiResponseSchema(
    z.array(z.string()).openapi({ example: ['Comment 1.', 'Comment 2.', 'Comment 3.'] })
).openapi('SuggestCommentResponse');

/**
 * Spec 5B P2B — Input for the AI comment-rewrite request.
 *
 * Used by the inspection editor's per-canned-comment "Rewrite" button. The
 * inspector picks a row, supplies an instruction (e.g. "make it more
 * specific to NW corner damage"), and the server asks Gemini to revise the
 * comment in-place.
 */
export const CommentEditSchema = z.object({
    itemLabel:       z.string().min(1).max(200).openapi({ example: 'Roof Covering' }).describe('TODO describe itemLabel field for the OpenInspection MCP integration'),
    sectionTitle:    z.string().min(1).max(200).openapi({ example: 'Roof' }).describe('TODO describe sectionTitle field for the OpenInspection MCP integration'),
    tab:             z.enum(['information', 'limitations', 'defects']).openapi({ example: 'defects' }).describe('TODO describe tab field for the OpenInspection MCP integration'),
    originalComment: z.string().min(1).max(4000).openapi({ example: 'Cracking observed across the field of the roof.' }).describe('TODO describe originalComment field for the OpenInspection MCP integration'),
    instruction:     z.string().min(1).max(500).openapi({ example: 'Make it more specific to the NW corner damage.' }).describe('TODO describe instruction field for the OpenInspection MCP integration'),
    category:        z.enum(['safety', 'recommendation', 'maintenance']).optional().openapi({ example: 'safety' }).describe('TODO describe category field for the OpenInspection MCP integration'),
    location:        z.string().max(200).optional().openapi({ example: 'Northwest corner' }).describe('TODO describe location field for the OpenInspection MCP integration'),
}).openapi('CommentEditRequest');

export const CommentEditResponseSchema = createApiResponseSchema(z.object({
    rewritten: z.string().openapi({ example: 'Major cracking observed at the NW corner of the roof field; recommend evaluation by a licensed roofer.' }).describe('TODO describe rewritten field for the OpenInspection MCP integration'),
})).openapi('CommentEditResponse');
