/**
 * Which status an inspection had before it was cancelled.
 *
 * Cancelling overwrites `status`, and no column keeps the old value, so restoring
 * to a fixed `scheduled` turned a cancelled COMPLETED job into a scheduled one whose
 * report was already published. The cancel route now writes the old status into its
 * audit row (`from`); this reads it back. A cancellation recorded before that was
 * written has no `from`, and is answered from what the row itself still says (for an
 * owner or manager); office staff restore only a cancellation that recorded its status.
 */
import { and, desc, eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { auditLogs } from '../db/schema';
import { REPORT_STATUS } from '../status/report-status';
import { INSPECTION_STATUS, isInspectionStatus, type InspectionStatus } from '../status/inspection-status';

/** What a `inspection.status_change` row says about a cancellation: that it is one, and the status it left. */
/** A status a cancelled inspection can be restored to: every status but `cancelled`. */
export type RestorableStatus = Exclude<InspectionStatus, 'cancelled'>;

function readCancel(metadata: unknown): { isCancel: boolean; isRestore?: boolean; from: RestorableStatus | null } {
    let meta = metadata;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { return { isCancel: false, from: null }; }
    }
    if (meta === null || typeof meta !== 'object') return { isCancel: false, from: null };
    const { to, from } = meta as { to?: unknown; from?: unknown };
    if (from === INSPECTION_STATUS.CANCELLED && isInspectionStatus(to) && to !== INSPECTION_STATUS.CANCELLED) return { isCancel: false, isRestore: true, from: null };
    if (to !== INSPECTION_STATUS.CANCELLED) return { isCancel: false, from: null };
    return { isCancel: true, from: isInspectionStatus(from) && from !== INSPECTION_STATUS.CANCELLED ? from : null };
}

/**
 * The status the LATEST cancellation recorded, or null when it recorded none. Only the
 * newest cancel row counts: an older cancel/restore cycle must not answer for this one,
 * so a newest cancel with no usable `from` is "unknown", never an earlier cycle's value
 * (a restore row met before any cancel row marks the earlier cycle as spent).
 */
export async function recordedStatusBeforeCancel(db: DrizzleD1Database, tenantId: string, inspectionId: string): Promise<RestorableStatus | null> {
    const rows = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entityId, inspectionId), eq(auditLogs.action, 'inspection.status_change')))
        .orderBy(desc(auditLogs.createdAt), sql`rowid desc`).limit(10).all();
    for (const r of rows) {
        const cancel = readCancel(r.metadata);
        if (cancel.isCancel) return cancel.from;
        // A restore newer than every cancel row means the cancel now in force left no row: that earlier cycle is spent.
        if (cancel.isRestore) return null;
    }
    return null;
}

/** The status to restore to: the recorded one, else what the row itself still says (owner and manager restores only). */
export async function statusBeforeCancel(
    db: DrizzleD1Database,
    tenantId: string,
    row: { id: string; reportStatus: string; confirmedAt: Date | null | undefined },
): Promise<RestorableStatus> {
    const recorded = await recordedStatusBeforeCancel(db, tenantId, row.id);
    if (recorded) return recorded;
    // No record: a report that has left in_progress belongs to a finished visit.
    if (row.reportStatus !== REPORT_STATUS.IN_PROGRESS) return INSPECTION_STATUS.COMPLETED;
    return row.confirmedAt ? INSPECTION_STATUS.CONFIRMED : INSPECTION_STATUS.SCHEDULED;
}
