import { and, eq, inArray, sql } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { inspections, inspectionInspectors } from './db/schema';
import { sameDayHour } from './calendar-conflict';
import { visibleInspectionIds, type InspectionScope } from './inspection/visibility';

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

/** A booked inspection that time off would cover. Deliberately an id, a civil date and a time window: no address, no names. */
export interface TimeOffConflict {
    id: string;
    /** The civil date, YYYY-MM-DD. */
    date: string;
    /** HH:mm, or null when the inspection has no time of day. */
    startTime: string | null;
    endTime: string | null;
}

/** How long a booked visit is assumed to last when nothing records it (the public booking default window). */
const DEFAULT_VISIT_MIN = 180;

const toMinutes = (hhmm: string): number => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
/** A visit that runs past midnight is shown ending at 23:59, not wrapped round to a morning time. */
const toHhmm = (min: number): string => {
    const m = Math.min(min, 24 * 60 - 1);
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

/**
 * The inspections this person is on (lead or helper) that a block of time off would
 * cover, so the caller can say so BEFORE or AFTER saving; it never blocks anything.
 *
 * Placement uses the inspection civil `date` (the booked wall-clock start, the
 * same value the booking busy-checks read) and its recorded duration, falling back
 * to the booking default. Only 'cancelled' is excluded, as in findScheduleConflicts.
 * An inspection with no time of day is reported for any block that day: better to
 * over-warn than to miss it. Touching intervals do not collide.
 *
 * Scoped to one company and one person, and cut to the inspections the asker may see
 * (`scope`, the same rule as the inspection lists); the caller decides whose calendar it
 * may ask about.
 */
export async function findTimeOffConflicts(
    db: DrizzleD1Database,
    tenantId: string,
    userId: string,
    scope: InspectionScope,
    block: { date: string; allDay: boolean; startTime?: string | null | undefined; endTime?: string | null | undefined },
): Promise<TimeOffConflict[]> {
    const visibleIds = visibleInspectionIds(db, scope, tenantId);
    const rows = await db.select({
        id: inspections.id,
        date: inspections.date,
        durationMin: inspections.durationMin,
    })
        .from(inspectionInspectors)
        .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
        .where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            eq(inspections.tenantId, tenantId),
            eq(inspectionInspectors.userId, userId),
            sql`date(${inspections.date}) = ${block.date}`,
            sql`${inspections.status} not in ('cancelled')`,
            visibleIds ? inArray(inspections.id, visibleIds) : undefined,
        ))
        .all();

    const blockStart = block.allDay || !block.startTime ? null : toMinutes(block.startTime);
    const blockEnd = block.allDay || !block.endTime ? null : toMinutes(block.endTime);
    return rows
        .map((r) => {
            const raw = String(r.date);
            const start = raw.length >= 16 ? toMinutes(raw.slice(11, 16)) : null;
            const end = start === null ? null : start + (r.durationMin ?? DEFAULT_VISIT_MIN);
            return { id: r.id, start, end };
        })
        .filter((r) => {
            if (blockStart === null || blockEnd === null) return true; // all day, or an open-ended block
            if (r.start === null || r.end === null) return true;       // no time of day: cannot rule it out
            return blockStart < r.end && r.start < blockEnd;
        })
        .map((r) => ({
            id: r.id,
            date: block.date,
            startTime: r.start === null ? null : toHhmm(r.start),
            endTime: r.end === null ? null : toHhmm(r.end),
        }))
        .sort((a, b) => (a.startTime ?? '').localeCompare(b.startTime ?? '') || a.id.localeCompare(b.id));
}
