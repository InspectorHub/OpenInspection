import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';

/**
 * Input for the comment assistance request.
 */
export const CommentAssistSchema = z.object({
    text: z.string().min(1, 'Text is required').openapi({ example: 'Roof is bad' }),
    context: z.string().optional().openapi({ example: 'Roof inspection' }),
}).openapi('CommentAssistRequest');

/**
 * Input for the automatic summary request.
 */
export const AutoSummarySchema = z.object({
    inspectionId: z.string().uuid().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }),
}).openapi('AutoSummaryRequest');

/**
 * Response for the comment assistance.
 */
export const CommentAssistResponseSchema = createApiResponseSchema(z.object({
    text: z.string().openapi({ example: 'The roof covering shows signs of significant wear and deterioration.' }),
})).openapi('CommentAssistResponse');

/**
 * Response for the automatic summary.
 */
export const AutoSummaryResponseSchema = createApiResponseSchema(z.object({
    summary: z.string().openapi({ example: 'The inspection revealed critical defects in the roofing and plumbing systems.' }),
})).openapi('AutoSummaryResponse');

/**
 * Input for the AI comment suggestion request.
 */
export const SuggestCommentSchema = z.object({
    itemName:        z.string().min(1).max(200).openapi({ example: 'Roof Covering' }),
    sectionName:     z.string().min(1).max(200).openapi({ example: 'Roof' }),
    rating:          z.string().optional().openapi({ example: 'Defect' }),
    propertyAddress: z.string().optional(),
    yearBuilt:       z.number().int().nullable().optional(),
    sqft:            z.number().int().nullable().optional(),
}).openapi('SuggestCommentRequest');

/**
 * Response for the AI comment suggestion.
 */
export const SuggestCommentResponseSchema = createApiResponseSchema(
    z.array(z.string()).openapi({ example: ['Comment 1.', 'Comment 2.', 'Comment 3.'] })
).openapi('SuggestCommentResponse');
