import { drizzle } from 'drizzle-orm/d1';
import { and, asc, eq } from 'drizzle-orm';
import {
    contacts,
    inspectionPeople,
    migrationBatches,
    migrationRows,
    tenantInvites,
} from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS, type MigrationBatchStatus } from '../../lib/status/migration-batch-status';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import { TemplateService } from '../template.service';
import { TeamService } from '../team.service';
import { parseContactPriorState } from './contact-snapshot';
import { Errors } from '../../lib/errors';
import type { EntityKind } from '../../lib/migration-intake/bundle';

export interface RevertParams {
    tenantId: string;
    batchId: string;
}

/**
 * One entry the undo could not take back, and why.
 *
 * Not exported: it is reachable as `RevertResult['refused'][number]`, and an
 * exported name nothing imports is a name the dead-code gate cannot tell from a
 * genuine leftover. Same reasoning as the staged-row shape next door.
 */
interface RevertRefusal {
    rowId: string;
    entity: EntityKind;
    /** Index within the bundle — how the report names the entry to the operator. */
    position: number;
    reason: string;
}

export interface RevertResult {
    status: MigrationBatchStatus;
    reverted: number;
    refused: RevertRefusal[];
}

type StagedRowRecord = typeof migrationRows.$inferSelect;

type IntakeDb = ReturnType<typeof drizzle>;

/** What one row's undo produced. A refusal carries the sentence the operator reads. */
type UndoOutcome = { kind: 'reverted' } | { kind: 'refused'; reason: string };

/**
 * Undoes an applied batch, row by row.
 *
 * A row that cannot be undone does not stop the others: it keeps its applied
 * status, its `outcome` is rewritten with the refusal, and the batch lands on
 * partially_reverted. Stopping at the first refusal would leave the operator
 * with a half-undone import and no list of what is left.
 *
 * Which way a row is undone is decided by whether it REPLACED something, and
 * the evidence for that is `prior_state` — written by the write itself, at the
 * moment it happened. The settlement column is deliberately NOT consulted: it
 * answers how a clash was settled, it is null for every batch-wide policy, and
 * a revert branching on it would read a batch-wide overwrite as a creation and
 * delete the row it was asked to restore.
 */
export class MigrationRevertService {
    constructor(private db: D1Database) {}

    private getDB(): IntakeDb {
        return drizzle(this.db);
    }

    async revert(params: RevertParams): Promise<RevertResult> {
        const db = this.getDB();

        const batch = await db.select().from(migrationBatches)
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');

        this.assertUndoable(batch.status);

        // Only rows that actually reached a real table. A skipped row changed
        // nothing, so it has nothing of its own to take back, and a failed row
        // never got as far as producing anything. Taken in bundle order so the
        // refusal list reads in the order of the file the operator uploaded.
        const rows = await db.select().from(migrationRows)
            .where(and(
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
                eq(migrationRows.status, MIGRATION_ROW_STATUS.APPLIED),
            ))
            .orderBy(asc(migrationRows.position))
            .all();

        const refused: RevertRefusal[] = [];
        let reverted = 0;

        for (const row of rows) {
            const outcome = await this.undoRow(db, params.tenantId, row);
            if (outcome.kind === 'reverted') {
                reverted++;
                // The reason it may have been carrying from an earlier refused
                // undo is cleared: a row must not go on explaining a state it
                // is no longer in.
                await db.update(migrationRows)
                    .set({ status: MIGRATION_ROW_STATUS.REVERTED, outcome: null })
                    .where(eq(migrationRows.id, row.id));
            } else {
                refused.push({
                    rowId: row.id,
                    entity: row.entity,
                    position: row.position,
                    reason: outcome.reason,
                });
                // Status stays applied — it still IS applied — and the reason
                // goes on `outcome`, which is what makes the refusal list
                // reconstructable from the table rather than only from this
                // return value.
                await db.update(migrationRows)
                    .set({ outcome: outcome.reason })
                    .where(eq(migrationRows.id, row.id));
            }
        }

        const status = refused.length > 0
            ? MIGRATION_BATCH_STATUS.PARTIALLY_REVERTED
            : MIGRATION_BATCH_STATUS.REVERTED;
        await db.update(migrationBatches)
            .set({ status, revertedAt: new Date() })
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ));

        return { status, reverted, refused };
    }

    /**
     * Whether this batch is in a state an undo can act on.
     *
     * A partially reverted batch IS undoable again: the rows that refused are
     * still applied, and pressing undo once the blocker is gone should pick
     * them up. The two refusals are separate sentences because one status
     * covering both would let "already undone" be reported as "never applied",
     * which sends the operator looking for a run that did not happen.
     */
    private assertUndoable(status: MigrationBatchStatus): void {
        const undoable: MigrationBatchStatus[] = [
            MIGRATION_BATCH_STATUS.APPLIED,
            MIGRATION_BATCH_STATUS.PARTIALLY_APPLIED,
            MIGRATION_BATCH_STATUS.PARTIALLY_REVERTED,
        ];
        if (undoable.includes(status)) return;
        if (status === MIGRATION_BATCH_STATUS.REVERTED) {
            throw Errors.BadRequest('This import has already been undone.');
        }
        throw Errors.BadRequest('This import has not been applied, so there is nothing to undo.');
    }

    /**
     * One row, one undo.
     *
     * The catch is what keeps a stubborn row from ending the run: anything
     * thrown from underneath becomes this row's refusal, and the rows after it
     * still get their turn.
     */
    private async undoRow(
        db: IntakeDb,
        tenantId: string,
        row: StagedRowRecord,
    ): Promise<UndoOutcome> {
        if (!row.createdId) {
            return {
                kind: 'refused',
                reason: 'This entry has no record of what it produced, so it cannot be undone.',
            };
        }
        try {
            if (row.entity === 'template') return await this.undoTemplate(tenantId, row, row.createdId);
            if (row.entity === 'contact') return await this.undoContact(db, tenantId, row, row.createdId);
            return await this.undoMember(db, tenantId, row.createdId);
        } catch (err) {
            return { kind: 'refused', reason: err instanceof Error ? err.message : String(err) };
        }
    }

    private async undoTemplate(
        tenantId: string,
        row: StagedRowRecord,
        createdId: string,
    ): Promise<UndoOutcome> {
        const service = new TemplateService(this.db);

        if (row.priorState !== null) {
            // An overwrite is undone by putting the old document back. The
            // service call is deliberate rather than a direct UPDATE: it
            // revalidates and recomputes the derived columns, so a restored
            // template is as consistent as one that was saved by hand — and a
            // snapshot that is present but is not a template is refused there
            // instead of being written over the row it was meant to rescue.
            // The name is not passed: the overwrite never changed it, so there
            // is nothing to put back and inventing one would rename the
            // template the operator was pointing at.
            await service.updateTemplate(createdId, tenantId, undefined, row.priorState);
            return { kind: 'reverted' };
        }

        // deleteTemplate owns the "may this go" question — the same gate the
        // Templates page uses. Its refusal already names the blocking
        // inspection, service, report or pack, which is exactly the sentence to
        // show here.
        await service.deleteTemplate(createdId, tenantId);
        return { kind: 'reverted' };
    }

    private async undoContact(
        db: IntakeDb,
        tenantId: string,
        row: StagedRowRecord,
        createdId: string,
    ): Promise<UndoOutcome> {
        if (row.priorState !== null) {
            const prior = parseContactPriorState(row.priorState);
            if (!prior) {
                return {
                    kind: 'refused',
                    reason: 'The record of what this contact held before cannot be read, so it was left as the import made it.',
                };
            }
            // Looked up first because an UPDATE that matches nothing succeeds
            // and changes nothing: without this, a contact somebody deleted in
            // the meantime would be reported as restored.
            const live = await db.select({ id: contacts.id }).from(contacts)
                .where(and(eq(contacts.id, createdId), eq(contacts.tenantId, tenantId)))
                .get();
            if (!live) {
                return { kind: 'refused', reason: 'This contact no longer exists, so there was nothing to put back.' };
            }
            // The address is not written back, and its absence here is the
            // point rather than an omission: it is what matched this row in the
            // first place, the overwrite never touched it, and writing it would
            // be the only way this undo could change which person the row is.
            await db.update(contacts).set({
                name: prior.name,
                phone: prior.phone,
                agency: prior.agency,
                type: prior.type,
            }).where(and(eq(contacts.id, createdId), eq(contacts.tenantId, tenantId)));
            return { kind: 'reverted' };
        }

        const usedBy = await db.select({ inspectionId: inspectionPeople.inspectionId })
            .from(inspectionPeople)
            .where(and(
                eq(inspectionPeople.contactId, createdId),
                eq(inspectionPeople.tenantId, tenantId),
            ))
            .limit(1)
            .get();
        if (usedBy) {
            return {
                kind: 'refused',
                reason: `This contact is named on inspection ${usedBy.inspectionId} and was kept.`,
            };
        }

        await db.delete(contacts)
            .where(and(eq(contacts.id, createdId), eq(contacts.tenantId, tenantId)));
        return { kind: 'reverted' };
    }

    /**
     * A member row created an INVITATION, and the token is the only handle it
     * holds — no account exists until somebody accepts.
     *
     * Three states, three answers, and they are told apart by reading the row
     * rather than by what the cancellation path throws: acceptance KEEPS the
     * invite row (it becomes the record of how that person got in), so a row
     * that has gone can only mean somebody cancelled it already. Reporting that
     * as a refusal would send the operator looking for an invitation that is
     * not there, and reporting it as an acceptance would be an invention.
     */
    private async undoMember(db: IntakeDb, tenantId: string, token: string): Promise<UndoOutcome> {
        const invite = await db.select({ status: tenantInvites.status }).from(tenantInvites)
            .where(and(eq(tenantInvites.id, token), eq(tenantInvites.tenantId, tenantId)))
            .get();
        if (!invite) return { kind: 'reverted' };
        if (invite.status !== 'pending') {
            return {
                kind: 'refused',
                reason: 'This person has already joined, so the invitation cannot be taken back. Remove them from the Team page instead.',
            };
        }

        // Reuses the existing cancellation path rather than deleting the row
        // here: that path re-asserts pending inside the DELETE itself, so an
        // invitation accepted between the read above and the write is left as
        // the history it now is. The seat comes back the moment the row goes,
        // because usage counts outstanding invitations.
        const team = new TeamService(this.db);
        await team.cancelInvite(tenantId, token);
        return { kind: 'reverted' };
    }
}
