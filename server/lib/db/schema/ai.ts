import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';

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

/**
 * AI content review evidence — one row per human review of model-assisted text,
 * naming the person, the artifact and the call that produced it.
 *
 * WHY IT IS NOT A COLUMN ON `ai_call_provenance`. That row is written BEFORE the
 * prompt leaves the process and names no artifact, because at that moment there
 * is none — acceptance is a separate, later write by whoever asked for the text.
 * Two events, two rows. They are joined on `ai_call_id`, and the join points AT
 * provenance and never the other way: putting an identifier of the inspection
 * INTO that table is the compliance change its own comment above forbids, while
 * pointing at it from here adds nothing to it.
 *
 * `model` AND `prompt_version` ARE DELIBERATELY ABSENT, not forgotten. Both are
 * already on the provenance row, written from `AI_PROMPTS[…].version` at the
 * chokepoint. Copied here they would become a second pair of values that must
 * agree with the first and eventually will not — and the copy is the one a
 * reader would trust, because it sits next to the review. Read them through
 * `ai_call_id`.
 *
 * WHAT A ROW CLAIMS, AND WHAT IT DOES NOT. It says a named user reviewed this
 * artifact at this time against that AI call. It does NOT say the output was
 * correct and it is not an absolution — review is necessary, not sufficient. The
 * row is the evidence that a review happened at all, which is the fact that
 * previously had no record anywhere: the AI call and its acceptance were two
 * events with nothing linking them.
 */
export const aiContentReviews = sqliteTable('ai_content_reviews', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** WHICH TABLE holds the row that received the text. `artifact_id` below is
     *  that row's primary key, so neither column means anything without the
     *  other. Enumerated rather than free text because a value naming no real
     *  table leaves a review row that cannot be resolved to anything, and
     *  nothing else in the system would notice. Adding a member is a deliberate
     *  change: it has to name a real table AND the column that model-assisted
     *  prose lands in there. */
    /**
     * ⚠️ ONE MEMBER, deliberately. A `report_version` member was drafted here and
     * removed after checking what that table's columns mean:
     * `report_versions.summary` is NOT a report summary — it is the per-publish
     * AMENDMENT REASON (`inspection-report.service.ts`: "Reason reuses
     * report_versions.summary", surfaced as `reason` in the amendment trail and
     * read into client delivery). There is no report-narrative column anywhere
     * yet, so a `report_version` member would name a home that does not exist.
     *
     * A reserved slot must not double as an unlocked door — the same rule the
     * capability policy states about `translate`. Add the member in the commit
     * that adds the field it points at.
     */
    artifactType: text('artifact_type', {
        enum: ['inspection_result'],
    }).notNull(),
    artifactId: text('artifact_id').notNull(),
    /** The STAFF user who reviewed the text (`users.id`), never a contact.
     *  Named `reviewed_by` and not `accepted_by` on purpose — the control that
     *  writes this row says "Review AI-assisted content before publication",
     *  and a column called "accepted" would quietly restate the claim counsel
     *  refused. Registered in `erasure-out-of-scope.ts`: a staff identity is
     *  not a consumer data subject, and the PII heuristic matches nothing in
     *  this name. */
    reviewedBy: text('reviewed_by').notNull(),
    reviewedAt: integer('reviewed_at', { mode: 'timestamp_ms' }).notNull(),
    /** -> `ai_call_provenance.id`. No `.references()` (Schema Rules): the join
     *  is enforced at the application layer like every other one here. */
    aiCallId: text('ai_call_id').notNull(),
}, (t) => ({
    /** "Has this artifact been reviewed?" — the question a publication path
     *  asks, and the only one that has to be fast. */
    byArtifact: index('idx_ai_content_reviews_tenant_artifact')
        .on(t.tenantId, t.artifactType, t.artifactId),
    /** The reverse walk: every review citing one AI call. */
    byAiCall: index('idx_ai_content_reviews_ai_call').on(t.aiCallId),
    /**
     * One review per (person, artifact, AI call) — which makes the write
     * NATURALLY IDEMPOTENT, and that is the point rather than a side effect.
     *
     * The same person confirming the same output twice is not two facts, so a
     * retried request must land as a no-op instead of a second row. The writer
     * pairs this with `ON CONFLICT DO NOTHING`; without the index that clause
     * has nothing to conflict on and the retry silently duplicates.
     *
     * ⚠️ `reviewed_by` is IN the key on purpose. Two people reviewing the same
     * output IS two facts — a second reviewer is exactly the evidence a
     * four-eyes policy would want — so the key must not collapse them.
     *
     * ⚠️ Unconditional unique is safe here only because all five columns are
     * NOT NULL. SQLite treats NULLs as distinct, so the moment any member of
     * this key becomes nullable this index stops constraining those rows and
     * says nothing about it.
     */
    oneReviewPerPersonPerCall: uniqueIndex('uq_ai_content_reviews_person_call')
        .on(t.tenantId, t.artifactType, t.artifactId, t.aiCallId, t.reviewedBy),
}));

export type AiContentReview = typeof aiContentReviews.$inferSelect;
export type NewAiContentReview = typeof aiContentReviews.$inferInsert;
