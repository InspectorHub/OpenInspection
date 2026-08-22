import { drizzle } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import { and, count, eq } from 'drizzle-orm';
import { migrationBatches, migrationRows } from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import { describeRowProblem, type RowProblem } from '../../lib/migration-intake/row-problems';
import { buildBundle, intakeSourceFromBytes, type IntakeMapping } from '../../lib/migration-intake/adapters/registry';
import { assertRowCountWithin, type IntakeLimits } from '../../lib/migration-intake/limits';
import { resolveConflicts, type IntakeDb } from '../../lib/migration-intake/conflicts';
import {
    ENTITY_FOR_INTENT,
    buildRowValues,
    plannedEntries,
    provenanceOf,
    rowInsertStatements,
} from '../../lib/migration-intake/staging-rows';
import type { EntityKind, VendorId } from '../../lib/migration-intake/bundle';
import { parseMigrationBundle } from '../../lib/validations/migration-bundle.schema';
import { MigrationSourceFileService } from './source-file.service';
import { Errors } from '../../lib/errors';

export interface RepairRowParams {
    tenantId: string;
    batchId: string;
    rowId: string;
    /** The whole entry as the operator now says it should read. */
    payload: unknown;
}

export interface RemapParams {
    tenantId: string;
    batchId: string;
    mapping: IntakeMapping;
    limits: IntakeLimits;
}

export interface RemapResult {
    /** How many entries the run carries now. */
    rowCount: number;
    /**
     * How many it carried before — every one of which was thrown away.
     *
     * Reported rather than left implicit because a re-map silently discards any
     * repair made since the last one. The caller is the only party that can put
     * that in front of the operator BEFORE they press the button, and it cannot
     * do so without the number.
     */
    replacedRowCount: number;
}

/** Which mapping shape describes each entity family. */
const MAPPING_KIND_FOR_ENTITY = {
    template: 'template',
    contact: 'contacts',
    member: 'members',
} as const satisfies Record<EntityKind, IntakeMapping['kind']>;

/**
 * Editing a run that has not been applied.
 *
 * Both operations here are only legal while the run is still being prepared.
 * That is not a caution: a staged run has written nothing, so changing it costs
 * nothing, while an applied one — or a partly applied one — has rows in real
 * tables whose only record of where they came from is the staging rows being
 * edited.
 */
export class MigrationRepairService {
    constructor(private db: D1Database, private bucket: R2Bucket) {}

    private getDB(): IntakeDb {
        return drizzle(this.db);
    }

    /**
     * The batch, if this tenant owns it and nothing has been written from it
     * yet.
     *
     * `staged` is the ONLY status that passes, `partially_applied` very much
     * included: that run has rows in real tables and rows still pending, so
     * replacing its rows would swap the record of what was written for a fresh
     * plan and let the remainder be applied twice.
     */
    private async loadEditableBatch(tenantId: string, batchId: string) {
        const db = this.getDB();
        const batch = await db.select().from(migrationBatches)
            .where(and(eq(migrationBatches.id, batchId), eq(migrationBatches.tenantId, tenantId)))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');
        if (batch.status !== MIGRATION_BATCH_STATUS.STAGED) {
            throw Errors.Conflict('This import is no longer being prepared, so it cannot be changed.');
        }
        return { db, batch };
    }

    /**
     * Rewrites one entry in place.
     *
     * Saves whatever the operator typed, even when it is still not writable,
     * and hands back what is left. Refusing a partial fix would mean every
     * field of a broken row has to be right in one go, which is exactly the
     * shape of edit a person doing eighty of them cannot make.
     *
     * The clash is recomputed for this row, because changing the email address
     * is precisely the edit that creates or removes one. So is the outcome
     * cleared: a sentence left over from a previous attempt describes a payload
     * this row no longer holds.
     */
    async repairRow(params: RepairRowParams): Promise<{ resolved: boolean; problem: RowProblem | null }> {
        const { db, batch } = await this.loadEditableBatch(params.tenantId, params.batchId);

        const row = await db.select().from(migrationRows)
            .where(and(
                eq(migrationRows.id, params.rowId),
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
            ))
            .get();
        if (!row) throw Errors.NotFound('Import entry not found');

        const [conflictWith] = await resolveConflicts(
            db, params.tenantId, row.entity, [params.payload], batch.targetId,
        );

        await db.update(migrationRows).set({
            payload: JSON.stringify(params.payload),
            conflictWith: conflictWith ?? null,
            status: MIGRATION_ROW_STATUS.PENDING,
            outcome: null,
        }).where(and(eq(migrationRows.id, row.id), eq(migrationRows.tenantId, params.tenantId)));

        const problem = describeRowProblem(row.entity, params.payload);
        return { resolved: problem === null, problem };
    }

    /**
     * Runs the adapter again with a different mapping and replaces every row.
     *
     * Replacing rather than merging: a different mapping produces a different
     * set of entries, and reconciling two sets by position would silently pair
     * up rows that have nothing to do with each other. What that costs is any
     * repair made since the last run, which is why the count of what went is
     * part of the answer rather than a detail the caller has to go and measure.
     *
     * This is the operation the stored file exists for. Without it, changing
     * one column choice would mean uploading again — and the batch the operator
     * has already been repairing would be a different batch.
     */
    async remap(params: RemapParams): Promise<RemapResult> {
        const { db, batch } = await this.loadEditableBatch(params.tenantId, params.batchId);

        // A re-map may change WHICH COLUMN feeds a field. It may not change what
        // the run imports: the family was settled by the entry point the
        // operator started from, and a mapping allowed to restate it would let a
        // contact import become a staff invite — which spends seats.
        const kind = ENTITY_FOR_INTENT[batch.intent];
        if (kind === null) {
            throw Errors.Conflict(
                'This import\'s file was converted for you, so its mapping cannot be changed here.',
            );
        }
        if (params.mapping.kind !== MAPPING_KIND_FOR_ENTITY[kind]) {
            throw Errors.BadRequest(
                `This import brings in ${kind}s, so its mapping has to describe ${kind}s.`,
            );
        }

        if (!batch.sourceKey) {
            throw Errors.Conflict('This import did not keep its file, so the mapping cannot be changed.');
        }
        const files = new MigrationSourceFileService(this.bucket);
        // BYTES. A vendor template export is a binary container, and a UTF-8
        // decode of one is not reversible — re-mapping through text would hand
        // the adapter a destroyed file and refuse the run for being unreadable.
        const bytes = await files.readBytes(batch.sourceKey);
        if (bytes === null) {
            throw Errors.Conflict(
                'This import\'s file is no longer stored, so the mapping cannot be changed. Start the import again.',
            );
        }

        const built = await buildBundle(
            batch.vendor as VendorId,
            intakeSourceFromBytes(batch.sourceKey, bytes),
            params.mapping,
        );
        if (!built.ok) throw Errors.BadRequest(built.error.message);

        const parsed = parseMigrationBundle(built.bundle);
        if (!parsed.ok) {
            throw Errors.UnprocessableEntity(
                'The remapped file did not produce a valid import.',
                { issues: parsed.issues },
            );
        }
        const bundle = parsed.bundle;

        const planned = plannedEntries(bundle, kind);
        if (planned.length === 0) throw Errors.BadRequest('That mapping produces nothing to import.');
        assertRowCountWithin(params.limits, planned.length);

        const rowValues = await buildRowValues(
            db, params.tenantId, params.batchId, planned, batch.targetId,
        );

        // Counted BEFORE the delete, and inside the same method that does it, so
        // the number handed back is the number of entries this call removed.
        const existing = await db.select({ n: count() }).from(migrationRows)
            .where(and(
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
            ))
            .get();

        // Delete and re-insert in ONE batch, so a run is never left with the old
        // rows gone and the new ones not yet there.
        const statements: BatchItem<'sqlite'>[] = [
            db.delete(migrationRows).where(and(
                eq(migrationRows.batchId, params.batchId),
                eq(migrationRows.tenantId, params.tenantId),
            )),
            ...rowInsertStatements(db, rowValues),
            db.update(migrationBatches)
                .set(provenanceOf(bundle.manifest))
                .where(and(
                    eq(migrationBatches.id, params.batchId),
                    eq(migrationBatches.tenantId, params.tenantId),
                )),
        ];
        await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

        return { rowCount: rowValues.length, replacedRowCount: existing?.n ?? 0 };
    }
}
