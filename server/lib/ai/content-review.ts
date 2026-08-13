import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { aiContentReviews, aiCallProvenance } from '../db/schema';
import { Errors } from '../errors';

/**
 * WHICH table `artifactId` points into. Derived from the schema column rather
 * than re-typed, so a member added to one and forgotten in the other cannot
 * compile — the union has been wrong in this direction before, when the enum
 * held a member no column existed for.
 */
export type AiReviewArtifactType = typeof aiContentReviews.$inferInsert['artifactType'];

/**
 * Record that a person reviewed model-assisted text before it was published.
 *
 * WHAT THIS IS EVIDENCE OF, precisely: a named staff user looked at the output
 * of one AI call, attached to one artifact, at one time. It is NOT a claim that
 * the output was correct, and it is not an absolution — review is necessary, not
 * sufficient. Counsel was explicit that "the user clicked confirm, therefore the
 * platform is absolved" is not a position this product may take, which is why
 * the column is `reviewed_by` and the control says *review*, never *accept*.
 *
 * ⚠️ IDEMPOTENT BY THE INDEX, not by a check-then-insert. The same person
 * confirming the same output twice is not two facts, so a retried request must
 * land as a no-op. `ON CONFLICT DO NOTHING` against
 * `uq_ai_content_reviews_person_call` does that atomically; a read-then-write
 * would race two concurrent retries into two rows and the unique index would
 * then reject the second with a 500 instead of shrugging.
 *
 * That property is also why this route is registered as idempotent BY DESIGN
 * rather than carrying a replay spec: there is no state a retry could corrupt.
 *
 * ⚠️ A SECOND REVIEWER IS NOT A DUPLICATE. `reviewed_by` is part of the unique
 * key, so two people reviewing the same output produce two rows — which is
 * exactly the evidence a four-eyes policy would want, and collapsing them would
 * destroy it.
 */
export async function recordContentReview(args: {
    db: D1Database;
    tenantId: string;
    artifactType: AiReviewArtifactType;
    artifactId: string;
    reviewedBy: string;
    aiCallId: string;
}): Promise<void> {
    const db = drizzle(args.db);

    // The call being reviewed must belong to THIS workspace. `tenantId` is taken
    // from the verified session, but `aiCallId` arrives in the request body, and
    // without this a caller could file a review citing another tenant's call —
    // writing a row that claims provenance it does not have, and putting one
    // workspace's identifier into another's audit ledger.
    //
    // Not a 403, and the message does not distinguish "no such call" from "not
    // yours": both answers would confirm the existence of an id the caller is
    // not entitled to know about.
    //
    // This read does NOT reintroduce the race the note above warns against.
    // That warning is about deciding whether a DUPLICATE review exists, which
    // must stay atomic and still does — the insert below is unchanged. This
    // check answers a different question, about a row the request cannot create
    // and no concurrent retry can change.
    const [call] = await db
        .select({ id: aiCallProvenance.id })
        .from(aiCallProvenance)
        .where(and(
            eq(aiCallProvenance.id, args.aiCallId),
            eq(aiCallProvenance.tenantId, args.tenantId),
        ))
        .limit(1);
    if (!call) throw Errors.NotFound('No AI call to review.');

    await db
        .insert(aiContentReviews)
        .values({
            id: crypto.randomUUID(),
            tenantId: args.tenantId,
            artifactType: args.artifactType,
            artifactId: args.artifactId,
            reviewedBy: args.reviewedBy,
            reviewedAt: new Date(),
            aiCallId: args.aiCallId,
        })
        .onConflictDoNothing();
}
