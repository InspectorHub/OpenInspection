import { and, eq, getTableColumns, inArray } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, reportTranslations, reports } from '../../lib/db/schema';
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
    // 0. Rows owned by a REPORT rather than by the inspection.
    //
    // The derived set below is every table carrying `inspection_id`, and it is
    // derived precisely so it cannot drift. What it cannot see is a table one
    // hop further out: `report_translations` is keyed by `report_id`, so the
    // loop deleted the reports and left the translated copy of their text
    // behind under an id nothing resolves. The retention catalogue excludes
    // that table from the calendar sweep on the ground that a translation dies
    // with its report, so this hop is what makes the exclusion true.
    //
    // The join is on `report_id` rather than fixing this by adding an
    // `inspection_id` column, which is what would have put the table in the
    // derived set automatically. A translation's owner is the DOCUMENT, and a
    // key that lies about what owns the row is a worse price than a hand-written
    // hop. The cost is that this hop is hand-written, which is why the
    // schema-shape guard in `inspection-cascade.spec.ts` fails the build if a
    // second `report_id`-keyed table ever appears without being handled here.
    //
    // BEFORE the loop, not after: `reports` is in the derived set, and its ids
    // are the only thing that can name these rows.
    const reportIds = (await db.select({ id: reports.id })
        .from(reports)
        .where(and(eq(reports.tenantId, tenantId), eq(reports.inspectionId, inspectionId))))
        .map((r) => r.id);
    if (reportIds.length > 0) {
        await db.delete(reportTranslations).where(and(
            eq(reportTranslations.tenantId, tenantId),
            inArray(reportTranslations.reportId, reportIds),
        ));
    }

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
