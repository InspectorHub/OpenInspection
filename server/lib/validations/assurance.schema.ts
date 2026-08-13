/**
 * Query + response contracts for the assurance-ledger read paths.
 *
 * Both endpoints these serve are GET-only over append-only tables, so the only
 * input any of them accepts is a page window. Kept in one file because the two
 * readers share the paging contract even though they do NOT share a guard: the
 * AI ledger is tenant-scoped and role-gated, the destruction ledger is
 * platform-level and M2M-gated. See `server/lib/compliance/assurance-records.ts`
 * for why that split is forced rather than chosen.
 */
import { z } from '@hono/zod-openapi';
import { createApiResponseSchema } from './shared.schema';
import { ASSURANCE_DEFAULT_PAGE, ASSURANCE_MAX_PAGE } from '../compliance/assurance-records';

/** Shared page window. `before` walks backwards through an append-only ledger. */
const pageWindow = {
    limit: z.coerce.number().int().min(1).max(ASSURANCE_MAX_PAGE).default(ASSURANCE_DEFAULT_PAGE)
        .describe('Maximum number of ledger rows to return, newest first.'),
    before: z.coerce.number().int().positive().optional()
        .describe('Epoch-ms exclusive upper bound; pass the previous page nextBefore to page back.'),
};

export const AiAssuranceQuerySchema = z.object(pageWindow).openapi('AiAssuranceQuery');

const AiReviewEntrySchema = z.object({
    id:           z.string().describe('ai_content_reviews row id.'),
    artifactType: z.string().describe('Which table holds the reviewed text: inspection_result or report.'),
    artifactId:   z.string().describe('Primary key of the reviewed row inside that table.'),
    reviewedBy:   z.string().describe('users.id of the staff member who reviewed the output.'),
    reviewerName: z.string().nullable().describe('Reviewer display name, null when the user row is gone.'),
    reviewedAt:   z.number().describe('Epoch-ms timestamp of the review.'),
});

const AiAssuranceCallSchema = z.object({
    id:            z.string().describe('ai_call_provenance row id, the value a review cites.'),
    capability:    z.string().describe('Which AI workload ran: assist or translate.'),
    provider:      z.string().describe('Adapter id of the backend that actually ran the call.'),
    mode:          z.string().describe('Whose credentials funded the call: managed or byo.'),
    model:         z.string().describe('Model id in force for this deployment at call time.'),
    promptVersion: z.string().describe('Stable version token of the prompt that was rendered.'),
    calledAt:      z.number().describe('Epoch-ms timestamp of the call.'),
    reviews:       z.array(AiReviewEntrySchema)
        .describe('Every recorded human review citing this call; empty means nobody reviewed it.'),
});

export const AiAssuranceResponseSchema = createApiResponseSchema(
    z.object({
        calls: z.array(AiAssuranceCallSchema)
            .describe('AI calls for this workspace, newest first, each with the reviews citing it.'),
        unresolvedReviewCount: z.number()
            .describe('Reviews whose cited call has no provenance row in this workspace.'),
        nextBefore: z.number().nullable()
            .describe('Epoch-ms cursor for the next older page, or null at the end of the ledger.'),
    }),
);

/**
 * Query for the platform-operator destruction-record read. `tenantId` is a
 * FILTER supplied by an operator over a platform-level table, NOT a scope taken
 * from a session — see the warning on `readDestructionRecords`. It is safe only
 * because the sole route carrying this schema is behind the portal M2M HMAC.
 */
export const DestructionRecordQuerySchema = z.object({
    tenantId: z.string().min(1).max(128).optional()
        .describe('Narrow to one destroyed workspace by its recorded tenant id.'),
    ...pageWindow,
});
