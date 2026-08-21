import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq } from 'drizzle-orm';
import {
    migrationBatches,
    migrationRows,
    type MigrationConflictPolicy,
    type MigrationRowResolution,
} from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS, type MigrationBatchStatus } from '../../lib/status/migration-batch-status';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import { applyMemberRow, type InviteDispatch } from './member-rows';
import { applyContactRow, applyTemplateRow, type RowOutcome } from './row-writers';
import { expiryFor } from './assistance.service';
import { getSeatUsage } from '../../features/seat-quota/usage';
import { assertBatchSeatsAvailable, computeSeatsNeeded } from '../../features/seat-quota/batch';
import { Errors } from '../../lib/errors';
import { claimBatchForApply } from '../../lib/migration-intake/apply-claim';
import { conflictDrift } from '../../lib/migration-intake/conflict-drift';
import { describeRowProblem } from '../../lib/migration-intake/row-problems';
import type { IntakeDb } from '../../lib/migration-intake/conflicts';

export interface ApplyParams {
    tenantId: string;
    batchId: string;
    /**
     * Chosen now, not at stage time — the operator answers it once they can see
     * which entries clash with something they already have.
     */
    conflictPolicy: MigrationConflictPolicy;
    /**
     * migration_rows.id -> settlement. Read only under the per-row policy; a
     * row with no answer keeps what is already there, because an unanswered
     * question is not consent to replace anything.
     */
    rowResolutions?: Record<string, MigrationRowResolution> | undefined;
    /** `profile.hasSeatQuota`. False short-circuits every seat check. */
    seatQuotaEnforced: boolean;
    billingPortalUrl?: string | null | undefined;
}

export interface ApplyResult {
    status: MigrationBatchStatus;
    applied: number;
    skipped: number;
    failed: number;
    invites: InviteDispatch[];
}

type StagedRowRecord = typeof migrationRows.$inferSelect;
type StagedBatchRecord = typeof migrationBatches.$inferSelect;

/**
 * Consumes a staged batch row by row.
 *
 * Only `pending` rows are read, which is the whole resumability story: an
 * interrupted run is finished by pressing the button again, and nothing that
 * already landed is written twice. Rows are taken in the order the bundle
 * carried them, so a report reads in the order of the file the operator
 * uploaded rather than in whatever order the storage layer felt like.
 */
export class MigrationApplyService {
    constructor(private db: D1Database) {}

    private getDB(): IntakeDb {
        return drizzle(this.db);
    }

    async apply(params: ApplyParams): Promise<ApplyResult> {
        const db = this.getDB();

        const batch = await db.select().from(migrationBatches)
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');

        const pending = await db.select().from(migrationRows)
            .where(and(
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
                eq(migrationRows.status, MIGRATION_ROW_STATUS.PENDING),
            ))
            .orderBy(asc(migrationRows.position))
            .all();

        await this.beforeRows(params, pending);

        // The status does not move off `staged` until the run is actually
        // going to be attempted. Anything that can refuse the whole batch has
        // to answer first, because a batch parked at `applying` by a refusal
        // reads afterwards as a run that started and stopped — and a retry of
        // it would look like a resumption of something that never ran.
        //
        // The move is also the CLAIM: a conditional update whose zero-row
        // result is the refusal. See lib/migration-intake/apply-claim.ts for
        // what it does and does not protect.
        const claimed = await claimBatchForApply(
            db, params.tenantId, params.batchId, params.conflictPolicy,
        );
        if (!claimed) {
            throw Errors.Conflict('This import is already being applied, or has already been applied.');
        }

        const invites: InviteDispatch[] = [];
        let applied = 0;
        let skipped = 0;
        let failed = 0;

        for (const row of pending) {
            const outcome = await this.applyRow(db, params, batch, row, invites);
            const now = new Date();
            // Under the per-row policy the operator answered for THIS row, and
            // the row is the only place that answer can be read back from.
            // Under a batch-wide policy the batch column already holds it, and
            // a second copy is a second thing that can disagree with the first.
            const resolution = row.conflictWith !== null && params.conflictPolicy === 'per_row'
                ? this.resolutionFor(params, row)
                : null;

            if (outcome.kind === 'applied') {
                applied++;
                await db.update(migrationRows).set({
                    status: MIGRATION_ROW_STATUS.APPLIED,
                    resolution,
                    createdId: outcome.createdId,
                    priorState: outcome.priorState,
                    outcome: null,
                    appliedAt: now,
                }).where(eq(migrationRows.id, row.id));
            } else if (outcome.kind === 'skipped') {
                skipped++;
                await db.update(migrationRows).set({
                    status: MIGRATION_ROW_STATUS.SKIPPED,
                    resolution,
                    outcome: outcome.reason,
                    appliedAt: now,
                }).where(eq(migrationRows.id, row.id));
            } else {
                failed++;
                await db.update(migrationRows).set({
                    status: MIGRATION_ROW_STATUS.FAILED,
                    resolution,
                    outcome: outcome.reason,
                    appliedAt: now,
                }).where(eq(migrationRows.id, row.id));
            }
        }

        // A run with any failure is not an applied run. A status column that
        // records a partial failure as a success has stopped answering the
        // question it exists for.
        const status = failed > 0
            ? MIGRATION_BATCH_STATUS.PARTIALLY_APPLIED
            : MIGRATION_BATCH_STATUS.APPLIED;
        const finishedAt = new Date();
        await db.update(migrationBatches)
            .set({
                status,
                appliedAt: finishedAt,
                // The undo window opens now, not when the file was uploaded.
                // Staging set a thirty-day clock so an unfinished run does not
                // sit forever; once the run has been applied that same clock is
                // measuring something else — how long the entries that make the
                // undo possible are kept. Leaving it where it was would give a
                // run applied on day twenty-nine a one-day undo.
                //
                // ONE instant for both columns: `applied_at` and the new due
                // date describe the same event, and two `new Date()` calls
                // would leave them milliseconds apart, reading like two things
                // that happened rather than one.
                expiresAt: expiryFor(false, finishedAt),
            })
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ));

        return { status, applied, skipped, failed, invites };
    }

    /**
     * Whole-batch checks, answered before any row is written and before the
     * batch is marked as running.
     *
     * The seat rule lives here rather than per row because a shortfall has to
     * refuse everything while nothing has been sent. Half a batch of invites is
     * a state nobody can read off the screen: some people got an email, some
     * silently did not, and no view afterwards distinguishes the two.
     *
     * The count is read from the live tenant rather than from the staged rows,
     * because staging can sit for a while — people join and invitations go out
     * in between, and headroom measured when the file was uploaded is not
     * headroom now.
     */
    private async beforeRows(params: ApplyParams, rows: StagedRowRecord[]): Promise<void> {
        // Rows the describer objects to are left OUT of the count. They will be
        // failed a moment from now and no invitation will go to any of them, so
        // counting them would refuse a whole batch over seats nothing was ever
        // going to take — and would state a number the operator cannot reconcile
        // with anything on their screen.
        const invitable = rows.filter((r) => describeRowProblem(r.entity, JSON.parse(r.payload)) === null);
        const needed = computeSeatsNeeded(invitable);
        if (needed === 0) return;
        const usage = await getSeatUsage(params.tenantId, this.db);
        assertBatchSeatsAvailable({
            needed,
            usage,
            enforced: params.seatQuotaEnforced,
            billingPortalUrl: params.billingPortalUrl ?? null,
        });
    }

    /**
     * How this row settles when it collides with something that already exists.
     *
     * An unanswered row under the per-row policy keeps what is already there.
     * The operator was shown the clash and said nothing about it, and silence
     * is not permission to replace somebody's data.
     */
    private resolutionFor(params: ApplyParams, row: StagedRowRecord): MigrationRowResolution {
        if (params.conflictPolicy === 'per_row') {
            return params.rowResolutions?.[row.id] ?? 'skip';
        }
        return params.conflictPolicy;
    }

    /**
     * One row, one write.
     *
     * The catch is what keeps a bad entry from ending the run: a row that
     * throws becomes a failed row carrying the reason, and the rows after it
     * still get their turn. An import that stops at the first bad line makes
     * the operator discover their file one error per attempt.
     */
    private async applyRow(
        db: IntakeDb,
        params: ApplyParams,
        batch: StagedBatchRecord,
        row: StagedRowRecord,
        invites: InviteDispatch[],
    ): Promise<RowOutcome> {
        try {
            // THE ROW'S OWN FAULTS, ASKED FIRST AND ANSWERED THE SAME WAY THE
            // SCREEN ANSWERS THEM.
            //
            // The staging format now carries entries that cannot be written —
            // an address that is not one, a contact type outside our vocabulary,
            // the agent role — because that is what makes them repairable. The
            // consequence is that this method can be handed one, so it asks the
            // same question the report asks and refuses with the same sentence.
            // Without it the widened format would reach a column enum, and an
            // address that is not one would become a real invitation.
            //
            // It refuses the ROW, not the batch: that is the whole ruling. The
            // rows around it still get their turn.
            const problem = describeRowProblem(row.entity, JSON.parse(row.payload));
            if (problem) return { kind: 'failed', reason: problem.reason };
            // Re-asked here rather than trusted from staging: the world can
            // move between the two, and a row whose answer moved is failed
            // rather than settled on either version of it.
            const drift = await conflictDrift(db, params.tenantId, batch.targetId, row);
            if (drift) return { kind: 'failed', reason: drift };
            // `resolutionFor` is asked unconditionally now that the writers
            // live next door. It is a pure read of what the operator answered,
            // and a writer with no clash to settle ignores it.
            const resolution = this.resolutionFor(params, row);
            if (row.entity === 'template') {
                return await applyTemplateRow(db, this.db, params.tenantId, batch, row, resolution);
            }
            if (row.entity === 'contact') {
                return await applyContactRow(db, params.tenantId, row, resolution);
            }
            if (row.entity === 'member') return await applyMemberRow(this.db, params, row, invites);
            return { kind: 'failed', reason: `No writer is wired for ${row.entity} rows.` };
        } catch (err) {
            return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
        }
    }
}
