/**
 * Who is allowed to start consuming a staged batch.
 *
 * A double click, or two administrators pressing the button in the same second,
 * are two executions of one run. This is a CONDITIONAL update and a zero-row
 * result IS the refusal — reading the status first and writing it second is the
 * same race written in two steps, with the window in the middle.
 *
 * The claim is NOT what stops a row being written twice; row status is. Apply
 * only consumes `pending` rows, so anything that already landed is skipped
 * whoever runs next. Keeping the two apart matters: a reader who thinks the
 * claim is the duplicate-write guard concludes that a lost claim means
 * duplicated data, and it does not.
 *
 * Its own module rather than a private method so `apply.service.ts` stays under
 * the file cap and so the stale window is a constant a test can read instead of
 * a number a test has to restate.
 */
import { and, eq, lt, or } from 'drizzle-orm';
import { migrationBatches, type MigrationConflictPolicy } from '../db/schema';
import { MIGRATION_BATCH_STATUS } from '../status/migration-batch-status';
import type { IntakeDb } from './conflicts';

/**
 * How long a batch may sit in `applying` before another executor may take it.
 *
 * A worker that died mid-run leaves the batch claimed by nobody, and reclaiming
 * it is safe — but the safety does NOT come from this window. It comes from
 * apply consuming only `pending` rows. The window exists solely so two LIVE
 * executors do not interleave, which is why it is minutes rather than the
 * hours a "surely it is dead by now" number would need to be.
 */
export const APPLY_CLAIM_STALE_MS = 5 * 60 * 1000;

/**
 * Rows the statement changed, across both drivers this code runs on.
 *
 * D1 reports it under `meta.changes`; the SQLite driver the unit suite uses
 * reports `changes`. A claim that could not read the count would have to fall
 * back to trusting the write — which is the check it is replacing.
 */
function changeCountOf(res: unknown): number {
    const r = res as { meta?: { changes?: number }; changes?: number } | undefined;
    return r?.meta?.changes ?? r?.changes ?? 0;
}

/**
 * Take the batch, or report that somebody else has it.
 *
 * `partially_applied` is claimable on purpose: a run that stopped half way —
 * because rows failed, or because it ran out of CPU — is resumed by pressing
 * the button again, and a claim that refused it would leave the failed half
 * with no way back.
 *
 * `applied_at` doubles as the claim instant. A separate `claimed_at` column
 * would exist only to hold the same value, and two columns that must agree are
 * two columns that can disagree.
 */
export async function claimBatchForApply(
    db: IntakeDb,
    tenantId: string,
    batchId: string,
    conflictPolicy: MigrationConflictPolicy,
    claimedAt: Date = new Date(),
): Promise<boolean> {
    const staleBefore = new Date(claimedAt.getTime() - APPLY_CLAIM_STALE_MS);
    const res = await db.update(migrationBatches)
        .set({
            status: MIGRATION_BATCH_STATUS.APPLYING,
            conflictPolicy,
            appliedAt: claimedAt,
        })
        .where(and(
            eq(migrationBatches.id, batchId),
            eq(migrationBatches.tenantId, tenantId),
            or(
                eq(migrationBatches.status, MIGRATION_BATCH_STATUS.STAGED),
                eq(migrationBatches.status, MIGRATION_BATCH_STATUS.PARTIALLY_APPLIED),
                and(
                    eq(migrationBatches.status, MIGRATION_BATCH_STATUS.APPLYING),
                    lt(migrationBatches.appliedAt, staleBefore),
                ),
            ),
        ))
        .run();
    return changeCountOf(res) > 0;
}
