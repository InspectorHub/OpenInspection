/**
 * The second retention executor that reaches outside D1 — and the only one that
 * CLEARS a row instead of deleting it.
 *
 * It sits beside `retention-report-pdfs.ts` for the same reason that one is not
 * in `retention-executors.ts`: the row points at an R2 object, so two stores
 * have to agree and the order they are touched in is a correctness property
 * rather than a detail. Everything left in the main file is a `db.delete(...)`
 * against one store.
 *
 * What makes this one different again is that the sweep's unit and the row are
 * not the same thing. A run's CONTENTS expire; the run's RECORD does not.
 */
import { and, eq, inArray, isNotNull, lt } from 'drizzle-orm';
import { migrationBatches, migrationRows } from '../db/schema';
import { MIGRATION_BATCH_STATUS } from '../status/migration-batch-status';
import { notHeld, type Executor } from './retention-executor-context';

/**
 * Intake runs: the file goes, the staged entries go, the RECORD stays.
 *
 * What expires here is a third party's name, email address and phone number —
 * held twice, once in the staging entries and once in the uploaded file. The
 * batch row holds neither: ids, timestamps, a vendor name, and two
 * authorisations given by this workspace's own people. Deleting it as well
 * would make a cleared run indistinguishable from one that never happened, and
 * would leave a status value nothing can ever write.
 *
 * Which value it lands on says who stopped. A run the operator staged and left
 * becomes `abandoned`; a run that was waiting on us becomes `expired`; a run
 * that already finished keeps the status it finished with — losing its entries
 * closes its undo window, it does not change its outcome.
 *
 * Compares each batch's OWN due date rather than the rule's `cutoff`: one table
 * carries two lifetimes, and which one a batch has is a property of the batch.
 * A row with no due date is left alone — that is a batch nothing has finished
 * writing, not one that has been sitting for ninety days.
 *
 * The bucket is demanded only when a due batch actually has an object, for the
 * same reason as the report-PDF rule: a deployment with nothing expired must
 * not have its whole sweep refused over a binding it never needed.
 *
 * Object first, entries second, key last. The batch row is the only thing that
 * knows the object's key, so clearing the key before deleting the object would
 * leave an object nothing can ever name again.
 *
 * The hold filter is applied on the SELECT, so the key list, the entry deletes
 * and the status writes are all built from the same filtered set. Filtering
 * only the writes would honour a preservation order in D1 and break it in R2,
 * and nothing would report the difference.
 *
 * The due date is cleared on the way out, which is what makes a second pass
 * report 0 instead of re-counting rows it did not change.
 */
export const migrationBatchesExecutor: Executor = async (rawDb, _cutoff, ctx) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const db = rawDb as any;
    const due = await db.select({ id: migrationBatches.id, sourceKey: migrationBatches.sourceKey })
        .from(migrationBatches)
        .where(and(
            isNotNull(migrationBatches.expiresAt),
            lt(migrationBatches.expiresAt, new Date(ctx.now)),
            notHeld(migrationBatches.tenantId, ctx),
        ))
        .all();
    if (due.length === 0) return 0;

    const keys = due
        .map((b: { sourceKey: string | null }) => b.sourceKey)
        .filter((k: string | null): k is string => typeof k === 'string' && k.length > 0);

    if (keys.length > 0) {
        const bucket = ctx.stores.photos;
        if (!bucket) {
            throw new Error(
                'migration_batches retention needs the photos bucket — refusing to clear rows that '
                + 'point at objects nothing else can reach. Pass { photos } to runLogRetentionSweep.',
            );
        }
        // Objects first. A throw here leaves every row exactly as it was.
        await bucket.delete(keys);
    }

    const ids = due.map((b: { id: string }) => b.id);
    await db.delete(migrationRows).where(inArray(migrationRows.batchId, ids)).run();

    // Three writes rather than one, because the new status depends on what the
    // old one was. A single blanket update would have to pick one answer for
    // runs that stopped for opposite reasons.
    const cleared = { sourceKey: null, expiresAt: null };
    await db.update(migrationBatches)
        .set({ ...cleared, status: MIGRATION_BATCH_STATUS.ABANDONED })
        .where(and(
            inArray(migrationBatches.id, ids),
            eq(migrationBatches.status, MIGRATION_BATCH_STATUS.STAGED),
        ))
        .run();
    await db.update(migrationBatches)
        .set({ ...cleared, status: MIGRATION_BATCH_STATUS.EXPIRED })
        .where(and(
            inArray(migrationBatches.id, ids),
            eq(migrationBatches.status, MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE),
        ))
        .run();
    // Everything else keeps its status and only loses its clock and its key.
    // The two updates above have already moved the ones that change, so this
    // one is a no-op for them.
    await db.update(migrationBatches)
        .set(cleared)
        .where(inArray(migrationBatches.id, ids))
        .run();

    // Runs taken down, which is what every other line of the sweep summary
    // means. NOT `changeCount` of the last statement: that one touches every
    // due row including the two already moved, and a count taken from it would
    // be right by coincidence rather than by construction.
    return ids.length;
};
