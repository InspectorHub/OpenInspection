/**
 * Track I-a GDPR (portal #88) — erasure executor for the repair-request lists.
 *
 * A repair request is a list a buyer or their agent builds from a published
 * report and shares with the seller's side. It is the one surface in the
 * product where the CLIENT, not the tenant, types prose — `custom_intro` at the
 * top of the document and a `note` per line item. Both routinely name people.
 *
 * Why this lives outside `erasure-orchestrator.ts`: that file is at its
 * anti-monolith line cap, and this is a self-contained two-table step. It is
 * registered through the orchestrator's `step()` recorder, so its decisions land
 * in the same append-only `erasure_log` row as every other step and a throw here
 * flips the run to `partially_completed` like any other.
 *
 * Two passes, because there are two ways a subject's data reaches this table:
 *
 *  1. Lists the SUBJECT authored -> the ROWS are deleted, items first. There is
 *     no legal-evidence basis for a client's own wish-list (the `contacts`
 *     posture, not the `invoices` one): nothing references a repair request, it
 *     is not financial, and it is not signed. Deleting it also destroys the
 *     `share_token`, which is a persistent link a contractor may still hold —
 *     an erased subject's links must stop working (the same call the
 *     `inspection_access_tokens` rule makes).
 *
 *  2. Lists SOMEBODY ELSE built on the subject's inspections -> the rows stay
 *     (they are that person's record) and only the free text is cleared. An
 *     agent's intro can name the buyer just as easily as the buyer's own can.
 *
 * KNOWN REACH LIMIT, stated rather than left to be discovered: pass 1 locates
 * lists by `created_by_ref`, which holds the actor's EMAIL only on the portal
 * -token path (`repair-access.ts`). An agent who authenticated through an
 * agent-portal session is recorded by user id instead, so a list they authored
 * is not found by an email lookup. That is the right outcome for a client
 * erasure — the agent is not the subject — but it does mean an agent who is
 * themselves the subject keeps an authorship reference to their own account id.
 * Pass 2 still clears the prose on those rows.
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { repairRequests, repairRequestItems } from '../db/schema';
import { changeCount } from './db-row-utils';

/**
 * The orchestrator's fail-closed step recorder. Passed in rather than imported
 * so this module cannot write to the decision log behind the orchestrator's
 * back, and so the counts it produces are aggregated exactly like the rest.
 */
type StepRecorder = (
    table: string,
    action: 'delete' | 'null' | 'erase_in_place',
    extra: { legalBasis?: 'art_17_3_b' | 'art_17_3_e'; retentionExpiry?: number },
    fn: () => Promise<number>,
) => Promise<void>;

export interface EraseRepairRequestsInput {
    tenantId: string;
    subjectEmail: string;
    /** Inspection ids the subject is a person on (via `inspection_people`). */
    inspectionIds: string[];
    step: StepRecorder;
}

export async function eraseRepairRequests(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    { tenantId, subjectEmail, inspectionIds, step }: EraseRepairRequestsInput,
): Promise<void> {
    // ── Pass 1: the subject's own lists, deleted whole ────────────────────────
    const ownRows = await db.select({ id: repairRequests.id }).from(repairRequests)
        .where(and(
            eq(repairRequests.tenantId, tenantId),
            eq(repairRequests.createdByRef, subjectEmail),
        ))
        .all();
    const ownIds = (ownRows as Array<{ id: string }>).map((r) => r.id);

    if (ownIds.length > 0) {
        // Items first: nothing enforces the parent link at the database level,
        // so deleting the parent first would strand them silently.
        await step('repair_request_items', 'delete', {}, async () =>
            changeCount(await db.delete(repairRequestItems)
                .where(and(
                    eq(repairRequestItems.tenantId, tenantId),
                    inArray(repairRequestItems.repairRequestId, ownIds),
                ))
                .run()));
        await step('repair_requests', 'delete', {}, async () =>
            changeCount(await db.delete(repairRequests)
                .where(and(
                    eq(repairRequests.tenantId, tenantId),
                    inArray(repairRequests.id, ownIds),
                ))
                .run()));
    }

    // ── Pass 2: other people's lists on the subject's inspections ─────────────
    if (inspectionIds.length === 0) return;
    const survivingRows = await db.select({ id: repairRequests.id }).from(repairRequests)
        .where(and(
            eq(repairRequests.tenantId, tenantId),
            inArray(repairRequests.inspectionId, inspectionIds),
        ))
        .all();
    const survivingIds = (survivingRows as Array<{ id: string }>).map((r) => r.id);
    if (survivingIds.length === 0) return;

    // Only the free text is cleared, and `repair_action_tag` (#275) is not free
    // text — it is a four-value classification of a defect, chosen from a fixed
    // list, naming nobody. So it needs no rule here and gets none; the reasoning
    // is registered in `erasure-out-of-scope.ts` alongside the snapshot columns.
    // Checked at this file rather than assumed from the register, because this is
    // where the rules actually execute and it is what the coverage spec's drift
    // scan reads.
    //
    // `isNotNull` is not an optimisation — it keeps the recorded count truthful.
    // Without it every row on the inspection reports as "cleared", and a
    // decision log that overstates what it did is the failure this log exists
    // to prevent.
    await step('repair_requests', 'null', {}, async () =>
        changeCount(await db.update(repairRequests).set({ customIntro: null })
            .where(and(
                eq(repairRequests.tenantId, tenantId),
                inArray(repairRequests.id, survivingIds),
                isNotNull(repairRequests.customIntro),
            ))
            .run()));
    await step('repair_request_items', 'null', {}, async () =>
        changeCount(await db.update(repairRequestItems).set({ note: null })
            .where(and(
                eq(repairRequestItems.tenantId, tenantId),
                inArray(repairRequestItems.repairRequestId, survivingIds),
                isNotNull(repairRequestItems.note),
            ))
            .run()));
}
