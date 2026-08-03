/**
 * Reads over the `reports` entity.
 *
 * One order can deliver several documents — a standard report and a radon
 * report — so "the report" is only ever a well-defined phrase once you say
 * WHICH. This module is where callers that still address things by inspection
 * resolve that.
 */
import { and, eq } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { reports } from '../db/schema';
import { logger } from '../logger';
import { REPORT_STATUS } from '../status/report-status';

/**
 * The primary report of an inspection, or null when it has none.
 *
 * Null is a real answer, not an error: an inspection whose report row has not
 * been created yet has nothing to open, and callers must fail closed rather
 * than fall back to an inspection-keyed document — that fallback is exactly the
 * shared-Y.Doc corruption this entity exists to prevent.
 */
export async function resolvePrimaryReportId(
    db: DrizzleD1Database,
    tenantId: string,
    inspectionId: string,
): Promise<string | null> {
    const row = await db.select({ id: reports.id }).from(reports)
        .where(and(
            eq(reports.tenantId, tenantId),
            eq(reports.inspectionId, inspectionId),
            eq(reports.kind, 'primary'),
        ))
        .get();
    return row?.id ?? null;
}

/**
 * Give an inspection its PRIMARY report.
 *
 * The minimum slice of report generation, not the whole of it: one report per
 * SOLD SERVICE is separate work. What has to hold now is that a primary report
 * always exists, because the collab route resolves an inspection to its primary
 * and fails CLOSED when there is none — correct, since the alternative is
 * falling back to an inspection-keyed document, which is the shared-Y.Doc bug,
 * but it means an inspection without one cannot be edited at all.
 *
 * Non-fatal by design. Both callers have already written the canonical
 * `inspections` row, and throwing here would lose it over a row that a backfill
 * can add later.
 */
export async function createPrimaryReport(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    db: any,
    tenantId: string,
    inspectionId: string,
    templateId: string | null,
): Promise<void> {
    try {
        await db.insert(reports).values({
            id: crypto.randomUUID(),
            tenantId,
            inspectionId,
            kind: 'primary',
            inspectionServiceId: null,
            templateId,
            title: 'Inspection Report',
            // The constant, not the literal — the status-literal gate exists
            // because a hand-typed status bypasses the type layer, which is how
            // ghost values reach runtime. `reports.status` is a narrower axis
            // than REPORT_STATUS (no 'submitted'), but 'in_progress' means the
            // same thing on both and they must not drift apart.
            status: REPORT_STATUS.IN_PROGRESS,
            createdAt: new Date(),
        });
    } catch (err) {
        logger.error('primary report create failed', { inspectionId },
            err instanceof Error ? err : undefined);
    }
}
