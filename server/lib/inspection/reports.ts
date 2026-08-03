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
