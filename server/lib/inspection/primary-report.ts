/**
 * Making sure an inspection has its primary report and its results row.
 *
 * Creating an inspection is several writes, not one: the `inspections` row, then
 * the primary report, then the `inspection_results` row that names it. D1 gives
 * no transaction across them, so a failure between two leaves an inspection that
 * exists but cannot be edited: the collab route resolves an inspection to its
 * primary report and answers 404 without one.
 *
 * For an inspection created under a client-chosen id that half-state would be
 * permanent, because the retry finds the row and answers as a replay. So the
 * writes after the first are done by this function, and a replay of the create
 * calls it again: it adds only what is missing and never duplicates anything.
 *
 * It is also safe against itself. Two requests can reach it for one inspection at
 * once (the create and a concurrent retry), and `reports` has no uniqueness on
 * "one primary report per inspection", so the report gets an id derived from the
 * inspection and the insert is a no-op for the loser; `uq_results_report` does
 * the same for the results row. Everything is scoped by `tenantId`.
 */

import { and, eq, isNull } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspectionResults } from '../db/schema';
import { createPrimaryReport, resolvePrimaryReportId } from './reports';

/** The id a primary report created by `ensurePrimaryReportAndResults` carries. Ids are opaque. */
function primaryReportIdFor(inspectionId: string): string {
    return `${inspectionId}-primary`;
}

/**
 * Give `inspectionId` a primary report and a results row that names it, adding
 * only what is missing. Returns the primary report's id, or null when the report
 * could not be created (the results row is still ensured, without a report id,
 * as creation always did).
 */
export async function ensurePrimaryReportAndResults(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
    templateId: string | null,
    now: Date,
): Promise<string | null> {
    const reportId = await resolvePrimaryReportId(db, tenantId, inspectionId)
        ?? await createPrimaryReport(db, tenantId, inspectionId, templateId, primaryReportIdFor(inspectionId));

    // The collaborative editor's Durable Object writes findings by UPDATEing this row, and an
    // UPDATE that matches nothing changes nothing without complaining: results exist for every
    // inspection, empty until someone rates something.
    const rows = await db.select({ id: inspectionResults.id, reportId: inspectionResults.reportId }).from(inspectionResults)
        .where(and(eq(inspectionResults.tenantId, tenantId), eq(inspectionResults.inspectionId, inspectionId)));
    if (reportId ? rows.some((r) => r.reportId === reportId) : rows.length > 0) return reportId;

    // A row an earlier attempt wrote before its report existed: adopt it rather than add a second.
    const orphan = reportId ? rows.find((r) => r.reportId === null) : undefined;
    if (orphan && reportId) {
        await db.update(inspectionResults).set({ reportId })
            .where(and(eq(inspectionResults.id, orphan.id), eq(inspectionResults.tenantId, tenantId), isNull(inspectionResults.reportId)));
        return reportId;
    }
    await db.insert(inspectionResults).values({
        id: crypto.randomUUID(),
        tenantId,
        inspectionId,
        ...(reportId ? { reportId } : {}),
        data: {},
        lastSyncedAt: now,
    }).onConflictDoNothing();
    return reportId;
}
