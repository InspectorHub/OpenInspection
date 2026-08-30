/**
 * Erasure executor for the owner block an authority's statutory form prints.
 *
 * Why this lives outside `erasure-orchestrator.ts`: that file is at its
 * anti-monolith line cap, and this is one self-contained step about one
 * subject — the same reason and the same shape as `erase-report-artifacts.ts`
 * and `erase-repair-requests.ts`. It is registered through the orchestrator's
 * own `step()` recorder, so its decision lands in the same append-only
 * `erasure_log` row as every other step and a throw here flips the run to
 * `partially_completed` like any other.
 *
 * ── 🔴 THE OWNER IS A THIRD PARTY, NOT THE SUBJECT ──────────────────────────
 * It is reached through the SUBJECT'S INSPECTIONS rather than by matching an
 * email, because there is no route by which the property owner is ever the
 * erasing subject: they have no account, no contact row and no login, so no
 * request ever arrives in their name. What ends here is the PURPOSE — those
 * numbers were collected to fill one document for one inspection, and when that
 * inspection's client is erased nothing is left that needs them.
 *
 * ── WHAT IS DELIBERATELY LEFT ALONE ─────────────────────────────────────────
 * The ROW survives, and `inspector_signature_date` with it: that is the day a
 * member of STAFF signed, which is a fact about the document rather than a
 * consumer data subject's personal data. It is declared in
 * `ERASURE_OUT_OF_SCOPE` on the same line of reasoning as `users.email`.
 *
 * ⚠️ A form already PRODUCED still carries what was printed on it. This clears
 * the source, not the delivered PDF; that document is governed by the
 * report-deliverable rules and expires on its own schedule.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { statutoryInspectionDetails } from '../db/schema';
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

export interface EraseStatutoryDetailsInput {
    tenantId: string;
    /** Inspection ids the subject is a person on (via `inspection_people`). */
    inspectionIds: string[];
    step: StepRecorder;
}

export async function eraseStatutoryDetails(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    { tenantId, inspectionIds, step }: EraseStatutoryDetailsInput,
): Promise<void> {
    await step('statutory_inspection_details', 'null', {}, async () => {
        if (inspectionIds.length === 0) return 0;
        const res = await db.update(statutoryInspectionDetails)
            .set({
                ownerName: null,
                ownerEmail: null,
                ownerMailingAddress: null,
                ownerHomePhone: null,
                ownerWorkPhone: null,
                ownerCellPhone: null,
                employeePrintedName: null,
            })
            .where(and(
                eq(statutoryInspectionDetails.tenantId, tenantId),
                inArray(statutoryInspectionDetails.inspectionId, inspectionIds),
            ))
            .run();
        return changeCount(res);
    });
}
