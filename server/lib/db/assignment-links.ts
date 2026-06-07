import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionInspectors } from './schema';

export interface AssignmentOpts {
    inspectorId?: string | null;
    leadInspectorId?: string | null;
    helperInspectorIds?: string[] | null;
}

/**
 * Shared statement builder — one inspection's full-replace resync as a list
 * of UNEXECUTED drizzle statements (delete + optional insert). Lead
 * resolution mirrors canEdit(): leadInspectorId ?? inspectorId. An
 * unassigned inspection simply yields the bare delete (zero rows after).
 */
function buildSyncStatements(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    opts: AssignmentOpts,
): unknown[] {
    const lead = opts.leadInspectorId ?? opts.inspectorId ?? null;
    const stmts: unknown[] = [
        db.delete(inspectionInspectors).where(and(
            eq(inspectionInspectors.inspectionId, inspectionId),
            eq(inspectionInspectors.tenantId, tenantId),
        )),
    ];
    const now = new Date();
    const rows: (typeof inspectionInspectors.$inferInsert)[] = [];
    if (lead) rows.push({ inspectionId, userId: lead, tenantId, role: 'lead', createdAt: now });
    for (const h of opts.helperInspectorIds ?? []) {
        if (h && h !== lead) rows.push({ inspectionId, userId: h, tenantId, role: 'helper', createdAt: now });
    }
    if (rows.length > 0) stmts.push(db.insert(inspectionInspectors).values(rows));
    return stmts;
}

/**
 * DB-8 dual-write — replaces the inspection_inspectors rows for one
 * inspection so the link table mirrors the canonical columns on
 * `inspections` (inspectorId / leadInspectorId / helperInspectorIds JSON).
 *
 * Call this AFTER any write that changes who is assigned. Full-replace
 * semantics: rows not re-supplied are removed. The helper never throws on
 * an unassigned inspection — it simply leaves zero rows.
 */
export async function syncInspectionAssignments(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    opts: AssignmentOpts,
): Promise<void> {
    await syncInspectionAssignmentsBatch(db, tenantId, [{ inspectionId, ...opts }]);
}

/**
 * B-29 — bulk resync for N inspections in ONE db.batch() round trip
 * (atomic on D1: a failed statement rolls back the whole replace, so the
 * mirror can never be left half-synced). Bulk call sites (admin import,
 * bulk-assign) used to loop the single sync → 2N sequential round trips.
 *
 * Drivers without batch support (e.g. the better-sqlite3 unit-test db)
 * fall back to sequential statements, matching the idiom in
 * service.service.ts setServiceInspectors / starter-content batchInsert.
 */
export async function syncInspectionAssignmentsBatch(
    db: DrizzleD1Database,
    tenantId: string,
    items: Array<{ inspectionId: string } & AssignmentOpts>,
): Promise<void> {
    const stmts = items.flatMap(it => buildSyncStatements(db, tenantId, it.inspectionId, it));
    if (stmts.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (db as any).batch === 'function') {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (db as any).batch(stmts as [any, ...any[]]);
    } else {
        for (const s of stmts) await s;
    }
}
