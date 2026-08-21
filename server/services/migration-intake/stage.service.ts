import { drizzle } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import { and, eq } from 'drizzle-orm';
import {
    migrationBatches,
    templates,
    type MigrationIntent,
} from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import { parseMigrationBundle } from '../../lib/validations/migration-bundle.schema';
import {
    MIGRATION_ENTITY_KINDS,
    type BundleTemplate,
    type EntityKind,
    type MigrationBundleV1,
} from '../../lib/migration-intake/bundle';
import type { IntakeDb } from '../../lib/migration-intake/conflicts';
import {
    ENTITY_FOR_INTENT,
    buildRowValues,
    entriesFor,
    plannedEntries,
    provenanceOf,
    rowInsertStatements,
    toStagedRow,
    type StagedRow,
} from '../../lib/migration-intake/staging-rows';
import {
    STAFF_ACCESS_AUTHORIZATION_VERSION,
    UPLOAD_AUTHORIZATION_VERSION,
} from '../../lib/migration-intake/authorizations';
import { assertRowCountWithin, type IntakeLimits } from '../../lib/migration-intake/limits';
import { Errors } from '../../lib/errors';

export interface StageParams {
    tenantId: string;
    /** users.id of the operator. Recorded so an undo can name who staged the run. */
    createdBy: string;
    intent: MigrationIntent;
    /** Required for the overwrite intent, meaningless for every other one. */
    targetId?: string | undefined;
    bundle: unknown;
    /** The caps in force for this deployment. Passed in, never read from a constant here. */
    limits: IntakeLimits;
    /** Where the source file was stored, when one was. */
    sourceKey?: string | null | undefined;
    /** This run's own due date. */
    expiresAt?: Date | null | undefined;
    /** users.id of whoever agreed to the file being kept. */
    uploadAuthorizedBy?: string | null | undefined;
}

export interface AssistanceBatchParams {
    tenantId: string;
    createdBy: string;
    intent: MigrationIntent;
    targetId?: string | null | undefined;
    /** Where the file was stored. Required — a waiting batch with no file has nothing to wait for. */
    sourceKey: string;
    expiresAt: Date;
    uploadAuthorizedBy: string;
    /** Required here and nowhere else: this route is the only one a person reads the file on. */
    staffAccessAuthorizedBy: string;
}

export interface StageIntoBatchParams {
    tenantId: string;
    batchId: string;
    bundle: unknown;
    limits: IntakeLimits;
}

export interface StageResult {
    batchId: string;
    rows: StagedRow[];
}

function plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Name the first few, then count the rest — a long list stops being readable. */
function nameSome(names: string[], limit = 3): string {
    if (names.length <= limit) return names.join(', ');
    return `${names.slice(0, limit).join(', ')} and ${names.length - limit} more`;
}

/**
 * Validates a bundle, works out what already exists, and records the whole
 * plan in the staging tables. It writes to nothing else.
 *
 * Splitting the run in two — decide everything here, do everything later — is
 * what makes an interrupted import resumable and an applied one undoable. It
 * also means a refusal happens while there is nothing to roll back.
 */
export class MigrationStageService {
    constructor(private db: D1Database) {}

    private getDB(): IntakeDb {
        return drizzle(this.db);
    }

    async stage(params: StageParams): Promise<StageResult> {
        const bundle = this.parseOrThrow(params.bundle);
        const kind = ENTITY_FOR_INTENT[params.intent];
        if (kind === null) {
            // An intent that names no entity kind cannot open a run here: this
            // method starts one from a file an adapter read, and the assisted
            // intent is by definition the case where none did. Its run is
            // opened by `createAssistanceBatch` and filled by `stageIntoBatch`,
            // which between them require the file's location and both
            // authorisations — none of which this method asks for. Accepting it
            // here would produce staged rows with no record of whose file they
            // came from or who agreed to it being kept.
            throw Errors.BadRequest('This import route needs a file whose kind is known.');
        }

        this.assertOnlyTheRequestedKind(bundle, kind);
        const planned = plannedEntries(bundle, kind);
        if (planned.length === 0) {
            throw Errors.BadRequest(`This file contains no ${kind}s to import.`);
        }
        assertRowCountWithin(params.limits, planned.length);

        const db = this.getDB();
        const targetId = await this.resolveTarget(db, params, bundle);

        const now = new Date();
        const batchId = crypto.randomUUID();
        const rowValues = await buildRowValues(db, params.tenantId, batchId, planned, targetId);

        const statements: BatchItem<'sqlite'>[] = [
            db.insert(migrationBatches).values({
                id: batchId,
                tenantId: params.tenantId,
                createdBy: params.createdBy,
                intent: params.intent,
                targetId,
                ...provenanceOf(bundle.manifest),
                status: MIGRATION_BATCH_STATUS.STAGED,
                createdAt: now,
                sourceKey: params.sourceKey ?? null,
                expiresAt: params.expiresAt ?? null,
                uploadAuthorizedBy: params.uploadAuthorizedBy ?? null,
                // The timestamp and the version come off the same condition as
                // the name, so a row can never say who agreed without saying
                // when, or to which wording.
                uploadAuthorizedAt: params.uploadAuthorizedBy ? now : null,
                uploadAuthorizationVersion: params.uploadAuthorizedBy ? UPLOAD_AUTHORIZATION_VERSION : null,
            }),
            ...rowInsertStatements(db, rowValues),
        ];
        await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

        return { batchId, rows: rowValues.map(toStagedRow) };
    }

    /**
     * Opens a run for a file nothing here can read.
     *
     * No rows and no bundle: there is nothing to plan yet. What it does carry is
     * everything needed to finish later — where the file is, when it stops being
     * kept, and both authorisations, recorded with the version of the wording
     * each was given under.
     */
    async createAssistanceBatch(params: AssistanceBatchParams): Promise<{ batchId: string }> {
        const db = this.getDB();
        const batchId = crypto.randomUUID();
        const now = new Date();
        await db.insert(migrationBatches).values({
            id: batchId,
            tenantId: params.tenantId,
            createdBy: params.createdBy,
            intent: params.intent,
            targetId: params.targetId ?? null,
            // Provenance is unknown until somebody reads the file; these are
            // placeholders the delivered bundle replaces, not guesses.
            vendor: 'csv_generic',
            adapterName: 'none',
            adapterVersion: '0',
            manifest: JSON.stringify({ warnings: [] }),
            status: MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE,
            createdAt: now,
            sourceKey: params.sourceKey,
            expiresAt: params.expiresAt,
            uploadAuthorizedBy: params.uploadAuthorizedBy,
            uploadAuthorizedAt: now,
            uploadAuthorizationVersion: UPLOAD_AUTHORIZATION_VERSION,
            staffAccessAuthorizedBy: params.staffAccessAuthorizedBy,
            staffAccessAuthorizedAt: now,
            staffAccessAuthorizationVersion: STAFF_ACCESS_AUTHORIZATION_VERSION,
        });
        return { batchId };
    }

    /**
     * Delivers a converted bundle into a batch that has been waiting for one.
     *
     * The SAME batch, deliberately. Everything the normal path earns — the
     * per-row plan, the resumable apply, the undo, and the fact that the
     * operator is the one who presses apply — comes from being the same
     * records; a separate insert path would have none of it.
     */
    async stageIntoBatch(params: StageIntoBatchParams): Promise<StageResult> {
        const db = this.getDB();
        const batch = await db.select().from(migrationBatches)
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');
        if (batch.status !== MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE) {
            throw Errors.Conflict('This import is not waiting for a converted file.');
        }

        const bundle = this.parseOrThrow(params.bundle);
        // The BATCH's intent, not one supplied with the delivery: what the
        // operator asked for was settled when they opened the run, and a
        // delivery allowed to restate it would be allowed to widen it.
        const kind = ENTITY_FOR_INTENT[batch.intent];
        if (kind !== null) this.assertOnlyTheRequestedKind(bundle, kind);
        if (batch.intent === 'templates.overwrite') this.assertSingleTemplate(bundle.templates);

        const planned = plannedEntries(bundle, kind);
        if (planned.length === 0) throw Errors.BadRequest('This bundle contains nothing to import.');
        assertRowCountWithin(params.limits, planned.length);

        const rowValues = await buildRowValues(
            db, params.tenantId, params.batchId, planned, batch.targetId,
        );
        await db.batch([
            db.update(migrationBatches).set({
                status: MIGRATION_BATCH_STATUS.STAGED,
                ...provenanceOf(bundle.manifest),
            }).where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            )),
            ...rowInsertStatements(db, rowValues),
        ] as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

        return { batchId: params.batchId, rows: rowValues.map(toStagedRow) };
    }

    /**
     * Records that a waiting run was looked at and could not be converted.
     *
     * A terminal state of its own, and not the one an untouched run reaches.
     * `abandoned` means the operator stopped; this means we did, having looked.
     * The two have opposite responsible parties, and a run that ends in the
     * wrong one misattributes the failure to the person who was waiting.
     *
     * The reason rides on the manifest, beside the expiry-reminder marks: this
     * table carries exactly one JSON payload, and a text column for a sentence
     * written once per run would be a column almost every row leaves null.
     */
    async declineBatch(params: { tenantId: string; batchId: string; reason: string }): Promise<void> {
        const db = this.getDB();
        const batch = await db.select().from(migrationBatches)
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ))
            .get();
        if (!batch) throw Errors.NotFound('Migration batch not found');
        if (batch.status !== MIGRATION_BATCH_STATUS.NEEDS_ASSISTANCE) {
            throw Errors.Conflict('This import is not waiting for a converted file.');
        }
        const manifest = JSON.parse(batch.manifest) as Record<string, unknown>;
        manifest.declineReason = params.reason;
        await db.update(migrationBatches)
            .set({ status: MIGRATION_BATCH_STATUS.DECLINED, manifest: JSON.stringify(manifest) })
            .where(and(
                eq(migrationBatches.id, params.batchId),
                eq(migrationBatches.tenantId, params.tenantId),
            ));
    }

    private parseOrThrow(input: unknown): MigrationBundleV1 {
        const parsed = parseMigrationBundle(input);
        if (!parsed.ok) {
            throw Errors.UnprocessableEntity(
                'That file is not a valid migration bundle.',
                { issues: parsed.issues },
            );
        }
        return parsed.bundle;
    }

    /**
     * An entry point that says "import contacts" may not quietly create team
     * invites. The bundle format can carry all three kinds; which one is meant
     * is decided by where the operator started, and anything else in the file
     * is named and refused rather than acted on.
     */
    private assertOnlyTheRequestedKind(bundle: MigrationBundleV1, kind: EntityKind): void {
        const extras: string[] = [];
        for (const other of MIGRATION_ENTITY_KINDS) {
            if (other === kind) continue;
            const count = entriesFor(bundle, other).length;
            if (count > 0) extras.push(plural(count, other));
        }
        if (extras.length > 0) {
            throw Errors.BadRequest(
                `This import brings in ${kind}s, but the file also contains ` +
                `${extras.join(' and ')}. Import those from their own page.`,
            );
        }
    }

    /**
     * Overwrite import has exactly one answerable target: the row the operator
     * was already looking at. A file with several templates has no answer to
     * "which one", so the whole batch is refused — with the count and the names
     * in it, because that is what tells the operator which file they picked.
     */
    private async resolveTarget(
        db: IntakeDb,
        params: StageParams,
        bundle: MigrationBundleV1,
    ): Promise<string | null> {
        if (params.intent !== 'templates.overwrite') return null;
        if (!params.targetId) {
            throw Errors.BadRequest('Overwrite import needs the template it is replacing.');
        }
        this.assertSingleTemplate(bundle.templates);
        const target = await db.select({ id: templates.id }).from(templates)
            .where(and(eq(templates.id, params.targetId), eq(templates.tenantId, params.tenantId)))
            .get();
        if (!target) throw Errors.NotFound('Template not found');
        return target.id;
    }

    private assertSingleTemplate(entries: BundleTemplate[]): void {
        if (entries.length === 1) return;
        throw Errors.BadRequest(
            `This export contains ${plural(entries.length, 'template')} ` +
            `(${nameSome(entries.map((t) => t.name))}); overwrite import accepts exactly 1. ` +
            'To bring them all in, start from the Templates list instead.',
        );
    }
}
