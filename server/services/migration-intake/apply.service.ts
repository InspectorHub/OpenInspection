import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq } from 'drizzle-orm';
import {
    contacts,
    migrationBatches,
    migrationRows,
    templates,
    type MigrationConflictPolicy,
    type MigrationRowResolution,
} from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS, type MigrationBatchStatus } from '../../lib/status/migration-batch-status';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import { TemplateService } from '../template.service';
import { Errors } from '../../lib/errors';
import type { BundleContact, BundleTemplate } from '../../lib/migration-intake/bundle';

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

/**
 * An invite this run created. Delivery is the caller's job: a method that both
 * writes rows and sends mail has no consistent retry, and who was written to
 * has to be the same record as what the run reports.
 */
export interface InviteDispatch {
    rowId: string;
    email: string;
    token: string;
    expiresAt: Date;
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

type IntakeDb = ReturnType<typeof drizzle>;

/**
 * What one row's write produced.
 *
 * `skipped` and `failed` are separate answers and are never merged: a skip is a
 * decision the operator made, a failure is something that went wrong, and a
 * report that calls one the other is telling the operator to go looking for a
 * bug that is not there — or not to look for one that is.
 */
type RowOutcome =
    | { kind: 'applied'; createdId: string; priorState: string | null }
    | { kind: 'skipped'; reason: string }
    | { kind: 'failed'; reason: string };

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

        // The status does not move off `staged` until the run is actually
        // going to be attempted. Anything that can refuse the whole batch has
        // to answer first, because a batch parked at `applying` by a refusal
        // reads afterwards as a run that started and stopped — and a retry of
        // it would look like a resumption of something that never ran.
        await db.update(migrationBatches)
            .set({ status: MIGRATION_BATCH_STATUS.APPLYING, conflictPolicy: params.conflictPolicy })
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ));

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
        await db.update(migrationBatches)
            .set({ status, appliedAt: new Date() })
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ));

        return { status, applied, skipped, failed, invites };
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
        _invites: InviteDispatch[],
    ): Promise<RowOutcome> {
        try {
            if (row.entity === 'template') return await this.applyTemplateRow(db, params, batch, row);
            if (row.entity === 'contact') return await this.applyContactRow(db, params, row);
            return { kind: 'failed', reason: `No writer is wired for ${row.entity} rows.` };
        } catch (err) {
            return { kind: 'failed', reason: err instanceof Error ? err.message : String(err) };
        }
    }

    private async applyTemplateRow(
        db: IntakeDb,
        params: ApplyParams,
        batch: StagedBatchRecord,
        row: StagedRowRecord,
    ): Promise<RowOutcome> {
        const payload = JSON.parse(row.payload) as BundleTemplate;
        const service = new TemplateService(this.db);

        if (batch.intent === 'templates.overwrite') {
            const targetId = row.conflictWith ?? batch.targetId;
            if (!targetId) return { kind: 'failed', reason: 'This overwrite has no target template.' };
            if (this.resolutionFor(params, row) === 'skip') {
                return { kind: 'skipped', reason: 'The existing template was kept, so this entry was not imported.' };
            }
            // Read what is live HERE, not at stage time: staging can sit for a
            // while, and a snapshot taken before an unrelated edit would
            // restore content the operator never had.
            const live = await db.select({ schema: templates.schema }).from(templates)
                .where(and(eq(templates.id, targetId), eq(templates.tenantId, params.tenantId)))
                .get();
            if (!live) return { kind: 'failed', reason: 'The template being replaced no longer exists.' };
            // The column is json-mode, so a row written through this service
            // reads back as the string it was handed while one written as an
            // object reads back as an object. Both are stored as the text the
            // undo will hand straight back.
            const priorState = typeof live.schema === 'string' ? live.schema : JSON.stringify(live.schema);

            // The NAME is left alone deliberately. The operator was standing on
            // this template when they started, so it is this template they meant
            // to refill — renaming it to whatever the export happened to be
            // called changes the thing they were pointing at. It also keeps the
            // snapshot above complete: the document is the only field this path
            // touches, so the document is the only field the undo has to
            // restore.
            await service.updateTemplate(
                targetId,
                params.tenantId,
                undefined,
                payload.schema as unknown as Record<string, unknown>,
            );
            return { kind: 'applied', createdId: targetId, priorState };
        }

        const created = await service.createTemplate(
            params.tenantId,
            payload.name,
            payload.schema as unknown as Record<string, unknown>,
        );
        return { kind: 'applied', createdId: created.id, priorState: null };
    }

    /**
     * The snapshot an undo restores, in a fixed shape written here and read by
     * the revert path. Both sides read this one function rather than each
     * writing down what they think the other stores — a field missing from the
     * snapshot is a field the undo silently fails to bring back, and an undo
     * that restores a partial row is worse than one that refuses.
     *
     * It carries exactly the columns the overwrite below touches, plus the
     * address it matched on, so restoring it returns the row to what it held.
     */
    private static contactPriorState(row: typeof contacts.$inferSelect): string {
        return JSON.stringify({
            name: row.name,
            email: row.email,
            phone: row.phone,
            agency: row.agency,
            type: row.type,
        });
    }

    private async applyContactRow(
        db: IntakeDb,
        params: ApplyParams,
        row: StagedRowRecord,
    ): Promise<RowOutcome> {
        const payload = JSON.parse(row.payload) as BundleContact;

        if (row.conflictWith) {
            if (this.resolutionFor(params, row) === 'skip') {
                return {
                    kind: 'skipped',
                    reason: 'A contact with this email address already exists and was left as it was.',
                };
            }
            const live = await db.select().from(contacts)
                .where(and(eq(contacts.id, row.conflictWith), eq(contacts.tenantId, params.tenantId)))
                .get();
            if (!live) return { kind: 'failed', reason: 'The contact being replaced no longer exists.' };
            const priorState = MigrationApplyService.contactPriorState(live);

            // EMAIL IS NOT WRITTEN, and its absence here is the point rather
            // than an omission: the address is what identified this row as the
            // one to replace, so rewriting it would make the row a different
            // person while claiming to have updated the same one. Every other
            // field takes what the file said, including the empty ones — a row
            // that blends the file with what was already there is a row no
            // source can account for.
            await db.update(contacts).set({
                name: payload.name,
                phone: payload.phone ?? null,
                agency: payload.agency ?? null,
                type: payload.type,
            }).where(and(eq(contacts.id, live.id), eq(contacts.tenantId, params.tenantId)));

            return { kind: 'applied', createdId: live.id, priorState };
        }

        const id = crypto.randomUUID();
        await db.insert(contacts).values({
            id,
            tenantId: params.tenantId,
            type: payload.type,
            name: payload.name,
            email: payload.email ?? null,
            phone: payload.phone ?? null,
            agency: payload.agency ?? null,
            createdAt: new Date(),
        });
        return { kind: 'applied', createdId: id, priorState: null };
    }
}
