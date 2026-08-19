/**
 * Turning a validated bundle into the rows that record a plan.
 *
 * Separate from the service because BOTH ways a run can start — a file an
 * adapter read, and a file a person converted for us — arrive here with the
 * same question: which entries is this run carrying, what does each one collide
 * with, and how are they written in one go. Two copies of that answer would be
 * two chances for a delivered bundle to be staged on slightly different terms
 * from an uploaded one.
 */
import type { BatchItem } from 'drizzle-orm/batch';
import { migrationRows } from '../db/schema';
import { MIGRATION_ROW_STATUS } from '../status/migration-row-status';
import { resolveConflicts, type IntakeDb } from './conflicts';
import {
    MIGRATION_ENTITY_KINDS,
    type BundleContact,
    type BundleMember,
    type BundleTemplate,
    type EntityKind,
    type MigrationBundleV1,
} from './bundle';

/** One bundle entry, whichever kind of entry the run is carrying. */
type BundleEntry = BundleTemplate | BundleContact | BundleMember;

/** One entry of a bundle, tagged with the family and index a report will name it by. */
interface PlannedEntry {
    entity: EntityKind;
    position: number;
    payload: unknown;
}

/** A staging row as it goes to the database, before anything reads it back. */
interface StagedRowValues {
    id: string;
    batchId: string;
    tenantId: string;
    entity: EntityKind;
    position: number;
    payload: string;
    conflictWith: string | null;
    status: typeof MIGRATION_ROW_STATUS.PENDING;
}

/** What a caller learns about one staged entry without reading the table back. */
export interface StagedRow {
    id: string;
    entity: EntityKind;
    position: number;
    conflictWith: string | null;
}

export function entriesFor(bundle: MigrationBundleV1, kind: EntityKind): BundleEntry[] {
    switch (kind) {
        case 'template': return bundle.templates;
        case 'contact': return bundle.contacts;
        case 'member': return bundle.members;
    }
}

export function toStagedRow(r: StagedRowValues): StagedRow {
    return { id: r.id, entity: r.entity, position: r.position, conflictWith: r.conflictWith };
}

/**
 * Every entry this run will stage, tagged with its family and its index WITHIN
 * that family.
 *
 * A null kind means the entry point named none, and that run carries every
 * family. Numbering per family rather than across the batch keeps `position`
 * meaning what the format says it means — the index in the bundle's array for
 * that kind — so a report can point an operator at "the fourth contact" and
 * they can count to it in their own file. It also means the pair
 * (entity, position) is the identity of an entry, and `position` alone is not.
 */
export function plannedEntries(bundle: MigrationBundleV1, kind: EntityKind | null): PlannedEntry[] {
    const kinds = kind === null ? [...MIGRATION_ENTITY_KINDS] : [kind];
    const out: PlannedEntry[] = [];
    for (const k of kinds) {
        entriesFor(bundle, k).forEach((payload, position) => {
            out.push({ entity: k, position, payload });
        });
    }
    return out;
}

/**
 * The staging rows for a plan, each already carrying what it collides with.
 *
 * Conflicts are resolved one family at a time because that is the shape the
 * rule takes — a contact is matched against contacts — and the results are
 * put back by (family, position) rather than by list order, so a bundle
 * carrying several families cannot have one family's answers land on another's
 * rows.
 */
export async function buildRowValues(
    db: IntakeDb,
    tenantId: string,
    batchId: string,
    planned: PlannedEntry[],
    targetId: string | null,
): Promise<StagedRowValues[]> {
    const conflicts = new Map<string, string | null>();
    for (const kind of MIGRATION_ENTITY_KINDS) {
        const ofKind = planned.filter((p) => p.entity === kind);
        if (ofKind.length === 0) continue;
        const resolved = await resolveConflicts(
            db, tenantId, kind, ofKind.map((p) => p.payload), targetId,
        );
        ofKind.forEach((p, i) => conflicts.set(`${kind}:${p.position}`, resolved[i] ?? null));
    }
    return planned.map((p) => ({
        id: crypto.randomUUID(),
        batchId,
        tenantId,
        entity: p.entity,
        position: p.position,
        payload: JSON.stringify(p.payload),
        conflictWith: conflicts.get(`${p.entity}:${p.position}`) ?? null,
        status: MIGRATION_ROW_STATUS.PENDING,
    }));
}

/**
 * D1 caps bind parameters at 100 per prepared statement, so the VALUES lists
 * are chunked; the caller sends every chunk in ONE db.batch so a staged run is
 * never half-recorded. Same idiom as the invite-acceptance write in
 * auth.service.ts — no sequential fallback, because a fallback that looks
 * correct reopens the window the batch was introduced to close.
 */
export function rowInsertStatements(
    db: IntakeDb,
    rowValues: StagedRowValues[],
): BatchItem<'sqlite'>[] {
    const colsPerRow = Object.keys(rowValues[0]).length;
    const maxRowsPerStmt = Math.max(1, Math.floor(100 / colsPerRow));
    const out: BatchItem<'sqlite'>[] = [];
    for (let i = 0; i < rowValues.length; i += maxRowsPerStmt) {
        out.push(db.insert(migrationRows).values(rowValues.slice(i, i + maxRowsPerStmt)));
    }
    return out;
}
