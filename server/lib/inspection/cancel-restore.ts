/**
 * Which status an inspection had before it was cancelled.
 *
 * Cancelling overwrites `status`, and no column keeps the old value, so restoring
 * to a fixed `scheduled` turned a cancelled COMPLETED job into a scheduled one whose
 * report was already published. The cancel route now writes the old status into its
 * audit row (`from`); this reads it back. A cancellation recorded before that was
 * written has no `from`, and is answered from what the row itself still says.
 */
import { and, desc, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { auditLogs } from '../db/schema';
import { REPORT_STATUS } from '../status/report-status';
import { INSPECTION_STATUS, isInspectionStatus, type InspectionStatus } from '../status/inspection-status';

function fromOf(metadata: unknown): InspectionStatus | null {
    let meta = metadata;
    if (typeof meta === 'string') {
        try { meta = JSON.parse(meta); } catch { return null; }
    }
    if (meta === null || typeof meta !== 'object') return null;
    const { to, from } = meta as { to?: unknown; from?: unknown };
    return to === INSPECTION_STATUS.CANCELLED && isInspectionStatus(from) && from !== INSPECTION_STATUS.CANCELLED ? from : null;
}

export async function statusBeforeCancel(
    db: DrizzleD1Database,
    tenantId: string,
    row: { id: string; reportStatus: string; confirmedAt: Date | null | undefined },
): Promise<InspectionStatus> {
    const rows = await db.select({ metadata: auditLogs.metadata }).from(auditLogs)
        .where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.entityId, row.id), eq(auditLogs.action, 'inspection.status_change')))
        .orderBy(desc(auditLogs.createdAt)).limit(10).all();
    for (const r of rows) {
        const from = fromOf(r.metadata);
        if (from) return from;
    }
    // No record of it: a report that has left in_progress belongs to a finished visit.
    if (row.reportStatus !== REPORT_STATUS.IN_PROGRESS) return INSPECTION_STATUS.COMPLETED;
    return row.confirmedAt ? INSPECTION_STATUS.CONFIRMED : INSPECTION_STATUS.SCHEDULED;
}
