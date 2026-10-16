import { and, eq, inArray, isNull, ne, or } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionInspectors, inspections, users } from '../../lib/db/schema';
import { buildSyncStatements } from '../../lib/db/assignment-links';
import { Errors } from '../../lib/errors';

/**
 * What happens to a removed member's inspections.
 *
 * "Open" is an appointment that has not happened and a report that has not been
 * published: status requested/scheduled/confirmed and report not published.
 * Everything else (completed, cancelled, published) is a record of work somebody
 * did and keeps its inspector; nothing here rewrites it.
 */
const OPEN_STATUSES = ['requested', 'scheduled', 'confirmed'] as const;
const ASSIGNABLE_ROLES = ['owner', 'manager', 'inspector'] as const;

type Db = DrizzleD1Database;

export interface RemovalChoice { reassignTo?: string | undefined; unassign?: boolean | undefined }

export interface ReassignmentPlan {
    openInspections: number;
    /** Of those, the ones where the member was the lead (a helper seat is dropped, not left empty). */
    openAsLead: number;
    /** Inspections that still name the member but are finished: they keep their inspector for the record. */
    keptForRecord: number;
    /** Unexecuted statements: the reassignment writes only. */
    statements: unknown[];
}

/** The target must be an active owner/manager/inspector of THIS company, and not the leaver. */
async function assertReassignTarget(db: Db, tenantId: string, removedId: string, targetId: string): Promise<void> {
    const target = targetId === removedId ? undefined : await db.select({ id: users.id }).from(users)
        .where(and(
            eq(users.id, targetId), eq(users.tenantId, tenantId), isNull(users.deletedAt),
            inArray(users.role, [...ASSIGNABLE_ROLES]),
        )).get();
    if (!target) throw Errors.BadRequest('Reassign to an active owner, manager or inspector of this company');
}

/** Open inspections the member is on, as lead (either source) or helper. */
async function openInspectionsOf(db: Db, tenantId: string, userId: string) {
    const mine = db.select({ id: inspectionInspectors.inspectionId }).from(inspectionInspectors)
        .where(and(eq(inspectionInspectors.tenantId, tenantId), eq(inspectionInspectors.userId, userId)));
    return db.select({ id: inspections.id, inspectorId: inspections.inspectorId }).from(inspections)
        .where(and(
            eq(inspections.tenantId, tenantId),
            inArray(inspections.status, [...OPEN_STATUSES]),
            ne(inspections.reportStatus, 'published'),
            or(eq(inspections.inspectorId, userId), inArray(inspections.id, mine)),
        )).all();
}

export async function planReassignment(db: Db, tenantId: string, userId: string, choice: RemovalChoice): Promise<ReassignmentPlan> {
    if (choice.reassignTo && choice.unassign) throw Errors.BadRequest('Choose either reassignTo or unassign, not both');
    const open = await openInspectionsOf(db, tenantId, userId);
    // The target only matters when there is open work to move to it.
    if (choice.reassignTo && open.length > 0) await assertReassignTarget(db, tenantId, userId, choice.reassignTo);
    const named = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.inspectorId, userId))).all();
    const openNamed = open.filter(o => o.inspectorId === userId).length;
    const keptForRecord = named.length - openNamed;
    if (open.length === 0) return { openInspections: 0, openAsLead: 0, keptForRecord, statements: [] };
    const target = choice.reassignTo ?? null;
    if (!target && !choice.unassign) throw Errors.MemberHasOpenInspections(open.length);

    const mine = db.select({ id: inspectionInspectors.inspectionId }).from(inspectionInspectors)
        .where(and(eq(inspectionInspectors.tenantId, tenantId), eq(inspectionInspectors.userId, userId)));
    const links = await db.select().from(inspectionInspectors)
        .where(and(eq(inspectionInspectors.tenantId, tenantId), inArray(inspectionInspectors.inspectionId, mine))).all();

    const statements: unknown[] = [];
    let openAsLead = 0;
    for (const insp of open) {
        const rows = links.filter(l => l.inspectionId === insp.id);
        const lead = rows.find(r => r.role === 'lead')?.userId ?? insp.inspectorId;
        const helpers = rows.filter(r => r.role === 'helper').map(r => r.userId);
        const wasHelper = helpers.includes(userId);
        if (lead === userId) openAsLead += 1;
        const newLead = lead === userId ? target : lead;
        const newHelpers = helpers.filter(h => h !== userId);
        if (wasHelper && target && target !== newLead && !newHelpers.includes(target)) newHelpers.push(target);
        statements.push(
            ...buildSyncStatements(db, tenantId, insp.id, { leadInspectorId: newLead, helperInspectorIds: newHelpers }),
            db.update(inspections).set({ inspectorId: newLead })
                .where(and(eq(inspections.id, insp.id), eq(inspections.tenantId, tenantId))),
        );
    }
    return { openInspections: open.length, openAsLead, keptForRecord, statements };
}

/** One D1 batch (atomic); drivers without batch support, such as the unit-test database, run in order. */
export async function runAtomically(db: Db, writes: unknown[]): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (db as any).batch === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).batch(writes as [any, ...any[]]);
    } else {
        for (const w of writes) await w;
    }
}
