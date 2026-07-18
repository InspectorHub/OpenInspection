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
 * Collision model (A-polish 9b.3): when BOTH the candidate and an existing row
 * carry scheduled_start_ms, conflict is a half-open interval overlap
 * (aStart < bEnd && bStart < aEnd) — touching intervals do NOT collide. When
 * either side lacks the instant, it falls back to the same UTC hour BUCKET (per
 * sameDayHour, S3-9): 09:01↔09:59 collide; 09:59↔10:01 do not.
 *
 * @param db         Drizzle D1 database instance (or compatible).
 * @param tenantId   Tenant scope for the query.
 * @param inspectorId  The user id to check for conflicts.
 * @param date       Proposed date/time — ISO datetime or YYYY-MM-DD.
 * @param excludeId  Inspection id being rescheduled; excluded from results.
 * @param candidate  Optional precise interval of the proposed booking. When
 *                   given, rows that also carry an instant use interval overlap.
 */
export async function findScheduleConflicts(
    db: DrizzleD1Database,
    tenantId: string,
    inspectorId: string,
    date: string,
    excludeId?: string,
    candidate?: { startMs: number | null; endMs: number | null },
): Promise<Array<{ inspectionId: string; propertyAddress: string; date: string }>> {
    const dayPart = date.slice(0, 10);

    const rows = await db.select({
        id:              inspections.id,
        propertyAddress: inspections.propertyAddress,
        date:            inspections.date,
        startMs:         inspections.scheduledStartMs,
        endMs:           inspections.scheduledEndMs,
    })
        .from(inspectionInspectors)
        .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
        .where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            eq(inspectionInspectors.userId, inspectorId),
            sql`date(${inspections.date}) = ${dayPart}`,
            // Deliberate: only 'cancelled' is excluded. Terminal statuses such as
            // 'completed' still surface — an advisory warning for a completed same-slot
            // inspection is acceptable; better to over-warn than silently miss it.
            sql`${inspections.status} not in ('cancelled')`,
        ))
        .all();

    const candStart = candidate?.startMs ?? null;
    const candEnd = candidate?.endMs ?? null;
    // D1 returns timestamp_ms columns as Date; normalize to epoch ms.
    const ms = (v: unknown): number | null =>
        v == null ? null : v instanceof Date ? v.getTime() : Number(v);

    return rows
        .filter((r) => {
            if (r.id === excludeId) return false;
            const rowStart = ms(r.startMs);
            const rowEnd = ms(r.endMs);
            // Precise on both sides → half-open interval overlap.
            if (candStart != null && candEnd != null && rowStart != null && rowEnd != null) {
                return candStart < rowEnd && rowStart < candEnd;
            }
            // Either side lacks an instant → legacy same-day-hour bucket.
            return sameDayHour(String(r.date), date);
        })
        .map(r => ({ inspectionId: r.id, propertyAddress: r.propertyAddress, date: String(r.date) }));
}
