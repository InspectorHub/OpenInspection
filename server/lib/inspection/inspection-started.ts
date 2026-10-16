/**
 * The database half of "has this inspection started?". The rule itself is
 * `inspectionStarted` in ./order-fields; this only fetches the one input it cannot
 * take from the inspection row, whether any results row holds a key.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { inspectionStarted } from './order-fields';

function hasKeys(data: unknown): boolean {
    if (typeof data === 'string') {
        try { return hasKeys(JSON.parse(data)); } catch { return false; }
    }
    return data !== null && typeof data === 'object' && Object.keys(data).length > 0;
}

/**
 * Whether the inspection has started. When the row already says so (report past
 * `in_progress`, or visit completed) the results are not read at all.
 */
export async function loadInspectionStarted(
    db: DrizzleD1Database,
    tenantId: string,
    row: { id: string; status: string; reportStatus: string },
): Promise<boolean> {
    if (inspectionStarted({ status: row.status, reportStatus: row.reportStatus, hasResultKeys: false })) return true;
    const rows = await db.select({ data: inspectionResults.data }).from(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.inspectionId, row.id))).all();
    return inspectionStarted({ status: row.status, reportStatus: row.reportStatus, hasResultKeys: rows.some((r) => hasKeys(r.data)) });
}
