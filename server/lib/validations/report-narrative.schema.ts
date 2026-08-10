import { z } from '@hono/zod-openapi';

/**
 * Bodies and payloads for the inspector's report-level narrative
 * (`reports.inspector_narrative`).
 *
 * ⚠️ The word `summary` appears nowhere here ON PURPOSE. `report_versions.summary`
 * is a different thing one join away — the per-publish amendment REASON — and a
 * request field called `summary` would be the shortest possible route to writing
 * one into the other. See the column comment in
 * `server/lib/db/schema/inspection/reports.ts`.
 */

/**
 * PATCH body. `null` clears the field; a blank or whitespace-only string is
 * normalised to NULL by the write path, so "cleared" is one state rather than
 * two indistinguishable ones.
 *
 * The key is REQUIRED, unlike the PCA narrative's all-optional patch. There is
 * exactly one field, so an empty body could only ever mean "I sent nothing by
 * mistake" — and accepting it would return 200 for a save that stored nothing,
 * which is how a UI comes to believe an unsaved draft is safe.
 *
 * Capped at 50_000 characters. Not a product limit — a report-level narrative is
 * paragraphs, not a book — but the column feeds an unbounded string into a D1
 * row, and a field with no ceiling is a field somebody eventually pastes a whole
 * report into.
 */
export const ReportNarrativePatchSchema = z.object({
    inspectorNarrative: z.string().max(50_000).nullable()
        .openapi({ example: 'The home is in generally sound condition for its age…' })
        .describe("The inspector's own prose about this report as a whole. Null or blank clears it."),
}).openapi('ReportNarrativePatchRequest');

/**
 * Read/write response payload.
 *
 * Carries the report id alongside the text because an `ai_content_reviews` row
 * for a model-assisted draft cites `artifact_type = 'report'` plus THIS id, and
 * a surface that offers AI assistance has to name the artifact before it may let
 * the text land. Echoing it here means the review call never has to reconstruct
 * which report it was editing.
 */
export const ReportNarrativePayloadSchema = z.object({
    reportId: z.string().openapi({ example: '550e8400-e29b-41d4-a716-446655440000' })
        .describe('reports.id — the artifact_id an ai_content_reviews row cites for this narrative.'),
    inspectorNarrative: z.string().nullable()
        .openapi({ example: 'The home is in generally sound condition for its age…' })
        .describe('The stored narrative, or null when none has been written.'),
}).openapi('ReportNarrativePayload');
