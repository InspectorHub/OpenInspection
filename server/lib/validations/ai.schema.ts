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
    inspectionId: z.string().trim().min(1).openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('TODO describe inspectionId field for the OpenInspection MCP integration'),
}).openapi('AutoSummaryRequest');

/**
 * WHY EVERY AI RESPONSE BELOW CARRIES `aiCallId`.
 *
 * It is the `ai_call_provenance.id` of the call that produced the text, and the
 * only thing an `ai_content_reviews` row can cite. Until the chokepoint returned
 * it, the ledger recorded every call and no response could say which row was
 * its own — so a review of this output had nothing to point at, and the AI call
 * and its acceptance stayed two events with nothing linking them.
 *
 * ⚠️ IT IS NOT `model` AND `promptVersion`, AND THAT IS THE DESIGN. Both are
 * already on the provenance row. Shipping them here would put deployment
 * configuration in a client payload and create a second pair of values that has
 * to agree with the first; they are read through this id instead.
 *
 * NULLABLE WHERE A NON-AI ARM EXISTS, required where none does. Three arms
 * return prose no model wrote — the standalone dev mocks, the "no defects
 * observed" literal, and the empty suggestion list a runtime failure degrades to
 * — and an id on any of those would be evidence of a review of model output
 * that was never generated. `null` means "there is nothing here to review". The
 * comment-assist path has no such arm, so its id is always a real row.
 */

/**
 * Response for the comment assistance.
 */
export const CommentAssistResponseSchema = createApiResponseSchema(z.object({
    text: z.string().openapi({ example: 'The roof covering shows signs of significant wear and deterioration.' }).describe('TODO describe text field for the OpenInspection MCP integration'),
    aiCallId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('The ai_call_provenance row id for this call — what a content-review record cites.'),
})).openapi('CommentAssistResponse');

/**
 * Response for the automatic summary.
 */
export const AutoSummaryResponseSchema = createApiResponseSchema(z.object({
    summary: z.string().openapi({ example: 'The inspection revealed critical defects in the roofing and plumbing systems.' }).describe('TODO describe summary field for the OpenInspection MCP integration'),
    aiCallId: z.string().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('The ai_call_provenance row id, or null when the summary is the system "no defects observed" literal rather than model output.'),
})).openapi('AutoSummaryResponse');

/**
 * Input for the AI comment suggestion request.
 *
 * NO PROPERTY ADDRESS, AND NOT BY OMISSION. The schema used to accept
 * `propertyAddress`; the prompt never referenced it, so the address was
 * validated and then dropped — a good outcome that rested entirely on a comment
 * in `lib/ai/prompts.ts` saying the prompt "names what it uses". One rewording
 * of that prompt would have started sending client addresses to a third-party
 * model with no change here, no change at the route, and nothing for a reviewer
 * to catch. The field is deleted rather than guarded: what does not exist
 * cannot be interpolated by accident. This object is the complete list of facts
 * the suggestion feature may send to a provider — adding an identifier of the
 * property or the client to it is a privacy decision, not a prompt tweak.
 * Guarded by `tests/unit/ai/prompt-address-boundary.spec.ts`.
 */
export const SuggestCommentSchema = z.object({
    itemName:        z.string().min(1).max(200).openapi({ example: 'Roof Covering' }).describe('TODO describe itemName field for the OpenInspection MCP integration'),
    sectionName:     z.string().min(1).max(200).openapi({ example: 'Roof' }).describe('TODO describe sectionName field for the OpenInspection MCP integration'),
    rating:          z.string().optional().openapi({ example: 'Defect' }).describe('TODO describe rating field for the OpenInspection MCP integration'),
    yearBuilt:       z.number().int().nullable().optional().describe('TODO describe yearBuilt field for the OpenInspection MCP integration'),
    sqft:            z.number().int().nullable().optional().describe('TODO describe sqft field for the OpenInspection MCP integration'),
}).openapi('SuggestCommentRequest');

/**
 * Response for the AI comment suggestion.
 *
 * `data` is an OBJECT and used to be the bare array. An array cannot carry the
 * provenance id, and the id is what a review of an accepted suggestion cites —
 * so the wrapper is the change, not an extra field on an existing one. Nothing
 * in `app/` consumes this endpoint (the AI routes are reached only by MCP/API
 * clients and the E2E suite today), so there is no client to migrate.
 */
export const SuggestCommentResponseSchema = createApiResponseSchema(z.object({
    suggestions: z.array(z.string()).openapi({ example: ['Comment 1.', 'Comment 2.', 'Comment 3.'] }).describe('The suggested comments, in the order the model returned them.'),
    aiCallId: z.string().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('The ai_call_provenance row id, or null when the suggestions are dev mocks or the list is empty because nothing usable came back.'),
})).openapi('SuggestCommentResponse');

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
    aiCallId: z.string().nullable().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' }).describe('The ai_call_provenance row id, or null when the rewrite is a standalone dev mock rather than model output.'),
})).openapi('CommentEditResponse');

/**
 * Transient (NOT stored as sent) confirmation that rides along with a save of
 * the workspace's OWN AI provider key on `PUT/POST /api/admin/secrets`.
 *
 * Every field is REQUIRED and has NO default: a missing statement must read as
 * "not confirmed", and a `.default(false)` would make that indistinguishable
 * from a caller who deliberately said no. The save is refused unless all three
 * are true; the route then turns them into the provider / mode / owner /
 * terms-version / timestamp / policy-version record on `tenant_configs`. The
 * statements and both version constants live in `server/lib/ai/byo-attestation.ts`.
 */
export const AiKeyAttestationSchema = z.object({
    reviewedProviderTerms: z.boolean().openapi({ example: true })
        .describe('The workspace has reviewed its AI provider terms.'),
    tierPermitsIntendedUse: z.boolean().openapi({ example: true })
        .describe('The service tier on their provider account permits their intended use.'),
    understandsProviderProcessing: z.boolean().openapi({ example: true })
        .describe('They understand inspection content is processed by that provider.'),
}).openapi('AiKeyAttestation');
