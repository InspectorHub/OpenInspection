import { eq, getTableColumns } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections } from '../../lib/db/schema';
import { inspectionScopedTables } from '../../lib/db/scoped-tables';

/**
 * Hard-delete an inspection and EVERY row + R2 asset it owns.
 *
 * D1 does not enforce foreign keys at runtime, so the `onDelete:'cascade'`
 * relations declared on child tables are inert — deleting only the inspection
 * row orphans results, services, invoices, agreement requests/signers, media
 * pool, report versions, messages, repair requests, units, tags, and (critically)
 * `inspection_access_tokens` that still resolve `/api/public/*` for the deleted
 * inspection, plus leaks the R2 objects. The child-table set is DERIVED from the
 * schema (every table with an `inspection_id` column) so it cannot drift.
 *
 * The caller MUST have already verified the inspection belongs to `tenantId`.
 */
export async function deleteInspectionCascade(
    db: DrizzleD1Database,
    r2: R2Bucket,
    tenantId: string,
    inspectionId: string,
): Promise<void> {
    // 1. Child rows (order irrelevant — D1 does not enforce FKs).
    for (const tbl of inspectionScopedTables()) {
        const col = getTableColumns(tbl).inspectionId as never;
        await db.delete(tbl).where(eq(col, inspectionId));
    }

    // 2. R2 objects — every inspection asset lives under `{tenantId}/inspections/{id}/`.
    const prefix = `${tenantId}/inspections/${inspectionId}/`;
    let cursor: string | undefined;
    do {
        const list = await r2.list({ prefix, limit: 1000, ...(cursor ? { cursor } : {}) });
        if (list.objects.length) await r2.delete(list.objects.map((o) => o.key));
        cursor = list.truncated ? list.cursor : undefined;
    } while (cursor);

    // 3. Finally the inspection row itself (keyed by `id`, not `inspection_id`).
    await db.delete(inspections).where(eq(inspections.id, inspectionId));
}
