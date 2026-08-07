import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

/**
 * AI call provenance — one row per prompt this deployment sends to a model
 * provider.
 *
 * WHY THE TABLE EXISTS. The prompts have carried stable version tokens
 * (`professional-comment.v1`, …) since they were extracted into
 * `lib/ai/prompts.ts`, and nothing read them: every call site rendered a string
 * and handed it to the provider. The governance artifact existed and produced
 * no evidence, so the question it was built to answer — which prompt produced
 * this text, on whose credentials, against which model, when — had no answer at
 * all, for any output ever generated. This table is that answer, written at the
 * one method every AI feature funnels through (`AIService.callGemini`), so no
 * capability can produce output without leaving a row.
 *
 * ⚠️ NO PROMPT TEXT IS STORED HERE, EVER, AND THAT IS A REQUIREMENT RATHER THAN
 * AN OVERSIGHT. The largest input to an AI call is inspector free text — a
 * defect note routinely names the client and the property address — so storing
 * the prompt would turn an accountability ledger into a second, unindexed copy
 * of client PII sitting outside every erasure path that exists for the first
 * one. Every column below is metadata ABOUT a call. Adding a column that
 * carries any part of the prompt, the completion, or an identifier of the
 * inspection is a compliance change, not a debugging convenience: it puts this
 * table into the erasure orchestrator's scope, which it is deliberately outside
 * of today (see the `ai_call_provenance` block in `erasure-manifest.ts`).
 *
 * WHY IT IS NOT THE USAGE COUNTER. `usage_counters` answers "how much", as one
 * summed number per (tenant, metric, month) — it cannot say which prompt
 * version or which model produced any particular output, and making it able to
 * would mean abandoning the aggregate that makes it a meter. Two tables, two
 * questions; both are written from the same chokepoint on the same resolved
 * credential source, so they can disagree about volume only if one of them is
 * broken.
 */
export const aiCallProvenance = sqliteTable('ai_call_provenance', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** Which AI workload ran. Same vocabulary as `AiUsageKind` and as the
     *  `ai_assist*`/`ai_translate*` usage metrics, so a provenance row and a
     *  metered unit describe the same call in the same words. */
    capability: text('capability', { enum: ['assist', 'translate'] }).notNull(),
    /** Adapter id of the backend that was called (`AiProvider.id`, e.g.
     *  'gemini'), taken from the adapter instance the call actually used rather
     *  than from configuration — a mismatch between the two is exactly the kind
     *  of thing this row exists to make visible. */
    provider: text('provider').notNull(),
    /** WHOSE credentials funded the call: the workspace's own key ('byo') or a
     *  platform key ('managed'). Resolved once per request beside the meter's
     *  tag and the capability gate's source, never re-derived here. */
    mode: text('mode', { enum: ['managed', 'byo'] }).notNull(),
    /** Model id as configured for the deployment at call time. Recorded because
     *  it is configuration: the same prompt version against a different model
     *  is a different output, and nothing else in the system remembers which
     *  one was in force. */
    model: text('model').notNull(),
    /** The `AI_PROMPTS[…].version` token of the prompt that was rendered. The
     *  reason the tokens are names and not hashes: this column is what makes an
     *  old output distinguishable from a new one after a rewording. */
    promptVersion: text('prompt_version').notNull(),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
}, (t) => ({
    byTenantTime: index('idx_ai_call_provenance_tenant_created').on(t.tenantId, t.createdAt),
}));

export type AiCallProvenance = typeof aiCallProvenance.$inferSelect;
export type NewAiCallProvenance = typeof aiCallProvenance.$inferInsert;
