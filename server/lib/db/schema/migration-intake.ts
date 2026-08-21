import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';
import { MIGRATION_BATCH_STATUS, MIGRATION_BATCH_STATUSES } from '../../status/migration-batch-status';
import { MIGRATION_ROW_STATUS, MIGRATION_ROW_STATUSES } from '../../status/migration-row-status';
import { MIGRATION_ENTITY_KINDS } from '../../migration-intake/bundle';

/**
 * What the operator asked for, decided by the entry point they used rather
 * than inferred from the payload. An entry point already states the intent;
 * inference has a case it gets wrong, an entry point does not.
 */
export const MIGRATION_INTENTS = [
    'templates.create',
    'templates.overwrite',
    'contacts.import',
    'members.invite',
    // The entry point for "I have an export and do not know which of these it
    // is". It is the one intent that does not name an entity family, because
    // the operator could not name one either — which is also why it is the one
    // intent that never runs an adapter.
    'assisted.full',
] as const;
export type MigrationIntent = typeof MIGRATION_INTENTS[number];

/** How conflicts are settled for a batch. Chosen at apply time, never at stage time. */
export const MIGRATION_CONFLICT_POLICIES = ['skip', 'overwrite', 'per_row'] as const;
export type MigrationConflictPolicy = typeof MIGRATION_CONFLICT_POLICIES[number];

/** A single row's settlement, written only under the `per_row` policy. */
export const MIGRATION_ROW_RESOLUTIONS = ['skip', 'overwrite'] as const;
export type MigrationRowResolution = typeof MIGRATION_ROW_RESOLUTIONS[number];

/**
 * One staged intake run.
 *
 * Staging exists so an import is resumable and undoable: nothing here touches
 * a real table, and a run can be staged repeatedly — each attempt is a new
 * batch and the previous one stays readable for comparison.
 *
 * No `.references()` per Schema Rules: D1 cannot rebuild a table an FK points
 * at, so referential integrity is the service layer's job (every query filters
 * `tenant_id`).
 */
export const migrationBatches = sqliteTable('migration_batches', {
    id: text('id').primaryKey(),
    tenantId: text('tenant_id').notNull(),
    /** users.id of the operator who staged it. Soft reference. */
    createdBy: text('created_by').notNull(),
    intent: text('intent', { enum: MIGRATION_INTENTS }).notNull(),
    /**
     * The row this run overwrites. Set ONLY for `templates.overwrite`, where
     * the operator was standing on the template when they started; NULL for
     * every other intent, because nothing else has a single named target.
     */
    targetId: text('target_id'),
    /** Provenance for display ("imported from Spectora on ...") — never matched on. */
    vendor: text('vendor').notNull(),
    adapterName: text('adapter_name').notNull(),
    adapterVersion: text('adapter_version').notNull(),
    /**
     * The bundle manifest, stringified ONCE at stage time and JSON.parsed
     * straight back — never re-serialized from a re-read row, so what a report
     * shows is the bytes the producing run made.
     */
    manifest: text('manifest').notNull(),
    /**
     * NULL while staged: the policy is a decision made at apply time, and a
     * default here would answer it for the operator. Under `per_row` the
     * per-row answers live on `migration_rows.resolution`.
     */
    conflictPolicy: text('conflict_policy', { enum: MIGRATION_CONFLICT_POLICIES }),
    status: text('status', { enum: [...MIGRATION_BATCH_STATUSES] })
        .notNull()
        .default(MIGRATION_BATCH_STATUS.STAGED),
    createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
    appliedAt: integer('applied_at', { mode: 'timestamp_ms' }),
    revertedAt: integer('reverted_at', { mode: 'timestamp_ms' }),
    /**
     * Where the uploaded file went in object storage, or NULL when nothing was
     * stored. The ONLY record of that location — re-mapping re-reads the file,
     * and the retention sweep deletes it, so both read this column.
     */
    sourceKey: text('source_key'),
    /**
     * When this batch's stored file and rows become due for deletion.
     *
     * A per-batch clock rather than one window for the table, because a run
     * waiting on a human has a different reason to exist from one the operator
     * staged and left. The catalogue rule states the OUTER bound; this column
     * is what the sweep actually compares against.
     */
    expiresAt: integer('expires_at', { mode: 'timestamp_ms' }),
    /**
     * Authorisation A — keeping the uploaded file, so a re-map is possible and
     * the page can be closed and reopened. Asked on every upload.
     *
     * The VERSION is stored, not just a flag. What somebody agreed to is the
     * wording that was on the screen, and that wording changes; a boolean
     * cannot be read back years later as an answer to "to what".
     */
    uploadAuthorizedBy: text('upload_authorized_by'),
    uploadAuthorizedAt: integer('upload_authorized_at', { mode: 'timestamp_ms' }),
    uploadAuthorizationVersion: text('upload_authorization_version'),
    /**
     * Authorisation B — a person on our side opening the file to convert it.
     * Asked ONLY when the operator chooses that route, and NULL everywhere
     * else.
     *
     * Separate from A on purpose. Merged, it would either over-ask (everyone
     * consenting to human access they never need) or under-ask (a file read by
     * somebody nobody authorised). And what B covers is third-party personal
     * data: the operator's own clients' names and contact details.
     */
    staffAccessAuthorizedBy: text('staff_access_authorized_by'),
    staffAccessAuthorizedAt: integer('staff_access_authorized_at', { mode: 'timestamp_ms' }),
    staffAccessAuthorizationVersion: text('staff_access_authorization_version'),
}, (t) => [
    index('idx_migration_batches_tenant_created').on(t.tenantId, t.createdAt),
    index('idx_migration_batches_expires').on(t.expiresAt),
]);

/**
 * One staged entity, one row. This granularity is the whole reason the design
 * has staging tables at all: it is what makes an interrupted apply resumable,
 * what makes an undo per-row rather than all-or-nothing, and what lets a
 * report name the failing entry instead of counting it.
 */
export const migrationRows = sqliteTable('migration_rows', {
    id: text('id').primaryKey(),
    batchId: text('batch_id').notNull(),
    tenantId: text('tenant_id').notNull(),
    entity: text('entity', { enum: MIGRATION_ENTITY_KINDS }).notNull(),
    /** Index within the bundle's array for this entity kind — how a report names the entry. */
    position: integer('position').notNull(),
    /** The bundle entry, stringified once at stage time. */
    payload: text('payload').notNull(),
    /** id of the existing row this one collides with; NULL = no collision. */
    conflictWith: text('conflict_with'),
    resolution: text('resolution', { enum: MIGRATION_ROW_RESOLUTIONS }),
    status: text('status', { enum: [...MIGRATION_ROW_STATUSES] })
        .notNull()
        .default(MIGRATION_ROW_STATUS.PENDING),
    /**
     * Why this row ended where it did, in words rather than a code.
     *
     * NULL does NOT mean "never failed" — it means "not carrying a reason
     * right now". A revert that is refused rewrites this with the refusal
     * while leaving `status` at applied, which is what makes a partially
     * reverted batch legible row by row.
     */
    outcome: text('outcome'),
    /** id of the row this one produced in the real table — the undo reads it. */
    createdId: text('created_id'),
    /**
     * What the overwritten row held before, captured during apply.
     *
     * Captured at apply time and not at stage time on purpose: staging can sit
     * for a while, and a snapshot taken before an unrelated edit would restore
     * the wrong content. Without this column an undo of an overwrite is a
     * claim, not an operation.
     */
    priorState: text('prior_state'),
    appliedAt: integer('applied_at', { mode: 'timestamp_ms' }),
}, (t) => [
    index('idx_migration_rows_batch_status').on(t.batchId, t.status),
    index('idx_migration_rows_tenant').on(t.tenantId),
]);
