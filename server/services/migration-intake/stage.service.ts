import { drizzle } from 'drizzle-orm/d1';
import type { BatchItem } from 'drizzle-orm/batch';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import {
    contacts,
    migrationBatches,
    migrationRows,
    templates,
    tenantInvites,
    users,
    type MigrationIntent,
} from '../../lib/db/schema';
import { MIGRATION_BATCH_STATUS } from '../../lib/status/migration-batch-status';
import { MIGRATION_ROW_STATUS } from '../../lib/status/migration-row-status';
import { parseMigrationBundle } from '../../lib/validations/migration-bundle.schema';
import type {
    BundleContact,
    BundleManifest,
    BundleMember,
    BundleTemplate,
    EntityKind,
    MigrationBundleV1,
} from '../../lib/migration-intake/bundle';
import { Errors } from '../../lib/errors';

export interface StageParams {
    tenantId: string;
    /** users.id of the operator. Recorded so an undo can name who staged the run. */
    createdBy: string;
    intent: MigrationIntent;
    /** Required for the overwrite intent, meaningless for every other one. */
    targetId?: string | undefined;
    bundle: unknown;
}

/**
 * Not exported: it is reachable as `StageResult['rows'][number]`, and an
 * exported name nothing imports is a name the dead-code gate cannot tell from
 * a genuine leftover.
 */
interface StagedRow {
    id: string;
    entity: EntityKind;
    position: number;
    conflictWith: string | null;
}

export interface StageResult {
    batchId: string;
    rows: StagedRow[];
}

/**
 * The entity an entry point imports. One kind each, by construction: an entry
 * point states what the operator meant, and a bundle carrying anything else is
 * a surprise rather than a convenience.
 *
 * Module-private: every caller reaches it through `stage()`, and an entry point
 * that needed to look the mapping up for itself would be deciding the intent a
 * second time.
 */
const ENTITY_FOR_INTENT: Record<MigrationIntent, EntityKind> = {
    'templates.create': 'template',
    'templates.overwrite': 'template',
    'contacts.import': 'contact',
    'members.invite': 'member',
};

/** One bundle entry, whichever kind of entry the run is carrying. */
type BundleEntry = BundleTemplate | BundleContact | BundleMember;

type IntakeDb = ReturnType<typeof drizzle>;

function entriesFor(bundle: MigrationBundleV1, kind: EntityKind): BundleEntry[] {
    switch (kind) {
        case 'template': return bundle.templates;
        case 'contact': return bundle.contacts;
        case 'member': return bundle.members;
    }
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
 * The four columns that record where a batch came from.
 *
 * The manifest is stringified HERE and exactly once. A report reads those bytes
 * back rather than a re-serialization of a re-parsed object, so what it shows
 * is what the producing run wrote — down to key order.
 */
function provenanceOf(manifest: BundleManifest) {
    return {
        vendor: manifest.source.vendor,
        adapterName: manifest.adapter.name,
        adapterVersion: manifest.adapter.version,
        manifest: JSON.stringify(manifest),
    };
}

/**
 * Remember the first row seen for an address, matched case-insensitively.
 *
 * First wins on purpose: when several rows answer to one address the earliest
 * is the one a later apply would have collided with, and picking a different
 * one each run would make the same file stage differently twice.
 */
function rememberByEmail(map: Map<string, string>, email: string | null, id: string): void {
    const key = (email ?? '').trim().toLowerCase();
    if (key && !map.has(key)) map.set(key, id);
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
        const parsed = parseMigrationBundle(params.bundle);
        if (!parsed.ok) {
            throw Errors.UnprocessableEntity(
                'That file is not a valid migration bundle.',
                { issues: parsed.issues },
            );
        }
        const bundle = parsed.bundle;
        const kind = ENTITY_FOR_INTENT[params.intent];

        this.assertOnlyTheRequestedKind(bundle, kind);

        const entries = entriesFor(bundle, kind);
        if (entries.length === 0) {
            throw Errors.BadRequest(`This file contains no ${kind}s to import.`);
        }

        const db = this.getDB();
        const targetId = await this.resolveTarget(db, params, bundle);
        const conflicts = await this.findConflicts(db, kind, params.tenantId, bundle, targetId);

        const batchId = crypto.randomUUID();
        const rowValues = entries.map((entry, position) => ({
            id: crypto.randomUUID(),
            batchId,
            tenantId: params.tenantId,
            entity: kind,
            position,
            payload: JSON.stringify(entry),
            conflictWith: conflicts[position] ?? null,
            status: MIGRATION_ROW_STATUS.PENDING,
        }));

        // D1 caps bind parameters at 100 per prepared statement, so the VALUES
        // lists are chunked; every chunk plus the batch row travels in ONE
        // db.batch so a staged run is never half-recorded. Same idiom as the
        // invite-acceptance write in auth.service.ts — no sequential fallback,
        // because a fallback that looks correct reopens the window the batch
        // was introduced to close.
        const colsPerRow = Object.keys(rowValues[0]).length;
        const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
        const statements: BatchItem<'sqlite'>[] = [
            db.insert(migrationBatches).values({
                id: batchId,
                tenantId: params.tenantId,
                createdBy: params.createdBy,
                intent: params.intent,
                targetId,
                ...provenanceOf(bundle.manifest),
                status: MIGRATION_BATCH_STATUS.STAGED,
                createdAt: new Date(),
            }),
        ];
        for (let i = 0; i < rowValues.length; i += maxRowsPerStmt) {
            statements.push(db.insert(migrationRows).values(rowValues.slice(i, i + maxRowsPerStmt)));
        }
        await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);

        return {
            batchId,
            rows: rowValues.map((r) => ({
                id: r.id,
                entity: r.entity,
                position: r.position,
                conflictWith: r.conflictWith,
            })),
        };
    }

    /**
     * An entry point that says "import contacts" may not quietly create team
     * invites. The bundle format can carry all three kinds; which one is meant
     * is decided by where the operator started, and anything else in the file
     * is named and refused rather than acted on.
     */
    private assertOnlyTheRequestedKind(bundle: MigrationBundleV1, kind: EntityKind): void {
        const extras: string[] = [];
        for (const other of ['template', 'contact', 'member'] as const) {
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

    /**
     * Which existing row each entry collides with, BY POSITION in the bundle.
     *
     * Matching is by email, never by a vendor identifier: an identifier from
     * one product is not an identity in another, and two vendors' identifiers
     * can collide. An entry with no email is never matched — merging two
     * different people who share a name cannot be undone, while a duplicate
     * can be merged later.
     */
    private async findConflicts(
        db: IntakeDb,
        kind: EntityKind,
        tenantId: string,
        bundle: MigrationBundleV1,
        targetId: string | null,
    ): Promise<(string | null)[]> {
        switch (kind) {
            case 'template':
                // The only template a run can collide with is the one it was
                // aimed at. Nothing else in the file has a named counterpart,
                // and a same-name template is not the same template.
                return bundle.templates.map(() => targetId);
            case 'contact':
                return this.contactConflicts(db, tenantId, bundle.contacts);
            case 'member':
                return this.memberConflicts(db, tenantId, bundle.members);
        }
    }

    /**
     * Mirrors the active-contact unique index: an ARCHIVED contact does not
     * hold the address, so importing that person again is a fresh row rather
     * than a clash. Comparison is case-insensitive, which is stricter than the
     * index — a differently-cased duplicate slips past the constraint and is
     * still a duplicate to the person reading the list.
     */
    private async contactConflicts(
        db: IntakeDb,
        tenantId: string,
        entries: BundleContact[],
    ): Promise<(string | null)[]> {
        if (!entries.some((c) => c.email?.trim())) return entries.map(() => null);
        const existing = await db.select({ id: contacts.id, email: contacts.email })
            .from(contacts)
            .where(and(
                eq(contacts.tenantId, tenantId),
                isNotNull(contacts.email),
                isNull(contacts.archivedAt),
            ))
            .all();
        const byEmail = new Map<string, string>();
        for (const row of existing) rememberByEmail(byEmail, row.email, row.id);
        return entries.map((c) => {
            const key = c.email?.trim().toLowerCase();
            if (!key) return null;
            return byEmail.get(key) ?? null;
        });
    }

    /**
     * A member "already exists" if the address holds a live workspace row or an
     * invite row that has not been accepted.
     *
     * The invite half is decided by the partial unique index on
     * (tenant_id, email), whose predicate is the pending status ALONE: while
     * such a row is there a second invite to that address cannot be written, so
     * calling it "no clash" would hand apply a row whose only outcome is a
     * constraint failure. Expiry does not enter into it — an expired invite is
     * a dead link, not a released address. An ACCEPTED invite is outside the
     * predicate and blocks nothing; the member row it produced is what the
     * first lookup finds, and a REMOVED member frees the address again.
     */
    private async memberConflicts(
        db: IntakeDb,
        tenantId: string,
        entries: BundleMember[],
    ): Promise<(string | null)[]> {
        const byEmail = new Map<string, string>();

        // Both lists are seat-bounded, so they are read whole and matched in
        // memory: neither column is stored case-folded, and an IN clause would
        // therefore answer only for addresses that happen to match in case.
        const activeUsers = await db.select({ id: users.id, email: users.email })
            .from(users)
            .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt)))
            .all();
        for (const row of activeUsers) rememberByEmail(byEmail, row.email, row.id);

        const outstanding = await db.select({ id: tenantInvites.id, email: tenantInvites.email })
            .from(tenantInvites)
            .where(and(eq(tenantInvites.tenantId, tenantId), eq(tenantInvites.status, 'pending')))
            .all();
        for (const row of outstanding) rememberByEmail(byEmail, row.email, row.id);

        return entries.map((m) => byEmail.get(m.email.trim().toLowerCase()) ?? null);
    }
}
