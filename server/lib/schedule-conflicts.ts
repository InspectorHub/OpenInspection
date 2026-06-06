import { and, eq, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionInspectors } from './db/schema';
import { sameDayHour } from './calendar-conflict';

/**
 * IA-6 — advisory same-day-hour collision lookup for one inspector.
 *
 * Counts both lead and helper assignments via the inspection_inspectors
 * link table. Callers render a warning; scheduling is never blocked.
 *
 * @param db         Drizzle D1 database instance (or compatible).
 * @param tenantId   Tenant scope for the query.
 * @param inspectorId  The user id to check for conflicts.
 * @param date       Proposed date/time — ISO datetime or YYYY-MM-DD.
 * @param excludeId  Inspection id being rescheduled; excluded from results.
 */
export async function findScheduleConflicts(
    db: DrizzleD1Database,
    tenantId: string,
    inspectorId: string,
    date: string,
    excludeId?: string,
): Promise<Array<{ inspectionId: string; propertyAddress: string; date: string }>> {
    const dayPart = date.slice(0, 10);

    const rows = await db.select({
        id:              inspections.id,
        propertyAddress: inspections.propertyAddress,
        date:            inspections.date,
    })
        .from(inspectionInspectors)
        .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
        .where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            eq(inspectionInspectors.userId, inspectorId),
            sql`date(${inspections.date}) = ${dayPart}`,
            sql`${inspections.status} not in ('cancelled')`,
        ))
        .all();

    return rows
        .filter(r => r.id !== excludeId && sameDayHour(String(r.date), date))
        .map(r => ({ inspectionId: r.id, propertyAddress: r.propertyAddress, date: String(r.date) }));
}
