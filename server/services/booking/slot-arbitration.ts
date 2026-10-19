import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { availabilityOverrides, calendarBlocks, inspections, inspectionInspectors, inspectionRequests } from '../../lib/db/schema';

/**
 * B-28 — post-insert TOCTOU arbitration and its compensation.
 *
 * The two functions are one mechanism and are extracted together for that
 * reason: `arbitrateSlotRace` is only meaningful because `revokeBooking` can
 * undo what the loser just wrote, and `revokeBooking` is only ever safe
 * because arbitration is the sole caller (the rows are milliseconds old and
 * nobody has been told the booking exists).
 */

/**
 * The slot read and the inspection insert in POST /book are not atomic (D1 has
 * no row locks), so two concurrent submits can both pass the advisory check
 * and double-book the same inspector. Instead of preventing the race we
 * resolve it after the fact: every racer calls this AFTER its own insert and
 * BEFORE any side effect (emails, calendar). All racers see the same
 * conflicting rows and apply the same deterministic order - sort by
 * (createdAt, id) - so the earliest booking wins and every later racer
 * self-compensates (revokeBooking + 409). Exactly one winner, no coordination.
 *
 * Why this is not a unique index: the sibling inspections of ONE multi-service
 * booking share an inspector and a start time on purpose, and the link table
 * carries no time at all, so no index on either table can say "this inspector,
 * this window, once".
 *
 * Two bookings collide when they are on the same inspector and day, not
 * cancelled, and either (a) both carry a recorded duration and their windows
 * [start, start + duration) overlap (back-to-back is fine), or (b) at least one
 * has no recorded duration and they start at the same HH:MM (the original rule,
 * kept for rows that never recorded a length). Rows of my own request never
 * collide with each other. Busy semantics otherwise mirror getTenantSlots:
 * link-table join, non-cancelled, HH:MM read from the ISO datetime at slice(11,16).
 *
 * A winner is then checked once more against TIME OFF added since the
 * availability was read: a calendar block, a manual blocking override, or a busy
 * event synced from a calendar that overlaps its window. The slot map applies the
 * same rules before the insert; this closes the window in between.
 */
export async function arbitrateSlotRace(
    d1: D1Database,
    tenantId: string,
    inspectorId: string,
    dateStr: string,
    time: string,
    myRequestId: string,
): Promise<'win' | 'lose'> {
    const db = drizzle(d1);
    const rows = await db.select({
        inspectionId: inspectionInspectors.inspectionId,
        requestId:    inspections.requestId,
        date:         inspections.date,
        createdAt:    inspections.createdAt,
        durationMin:  inspections.durationMin,
    })
        .from(inspectionInspectors)
        .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
        .where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            eq(inspectionInspectors.userId, inspectorId),
            sql`date(${inspections.date}) = ${dateStr}`,
            sql`${inspections.status} not in ('cancelled')`,
        )).all();

    type Row = typeof rows[number];
    const startOf = (r: Row): number | null => {
        const hhmm = String(r.date).slice(11, 16);
        return /^\d\d:\d\d$/.test(hhmm) ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null;
    };
    const collides = (a: Row, b: Row): boolean => {
        const sa = startOf(a);
        const sb = startOf(b);
        if (sa === null || sb === null) return false;
        if (a.durationMin && b.durationMin) return sa < sb + b.durationMin && sb < sa + a.durationMin;
        return sa === sb;
    };

    const mine = rows.filter(r => r.requestId === myRequestId);
    // No competitor - or our rows are not visible (nothing to arbitrate).
    if (mine.length === 0) return 'win';
    const others = rows.filter(r => r.requestId !== myRequestId && mine.some(m => collides(m, r)));
    if (others.length > 0) {
        type Key = [number, string];
        const key = (r: Row): Key => [
            r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt ?? 0),
            r.inspectionId,
        ];
        const cmp = (a: Key, b: Key) => a[0] - b[0] || (Number(a[1] > b[1]) - Number(a[1] < b[1]));
        const myKey    = mine.filter(m => others.some(o => collides(m, o))).map(key).sort(cmp)[0]!;
        const otherKey = others.map(key).sort(cmp)[0]!;
        if (cmp(otherKey, myKey) < 0) return 'lose';
    }

    const first = mine.find(m => startOf(m) !== null && String(m.date).slice(11, 16) === time) ?? mine[0]!;
    return (await timeOffCovers(db, tenantId, inspectorId, dateStr, startOf(first), first.durationMin ?? null)) ? 'lose' : 'win';
}

const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** True when time off for this inspector on this date now covers the booked window. */
async function timeOffCovers(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    inspectorId: string,
    dateStr: string,
    startMin: number | null,
    durationMin: number | null,
): Promise<boolean> {
    if (startMin === null) return false;
    // A booking with no recorded length is judged by its start alone, like the slot map does.
    const endMin = startMin + (durationMin ?? 1);
    const overlaps = (from: string, to: string) => startMin < toMin(to) && toMin(from) < endMin;

    const blocks = await db.select().from(calendarBlocks).where(and(
        eq(calendarBlocks.tenantId, tenantId), eq(calendarBlocks.userId, inspectorId), eq(calendarBlocks.date, dateStr),
    )).all();
    if (blocks.some(b => b.allDay || !b.startTime || !b.endTime ? b.allDay : overlaps(b.startTime, b.endTime))) return true;

    const overrides = (await db.select().from(availabilityOverrides).where(and(
        eq(availabilityOverrides.tenantId, tenantId), eq(availabilityOverrides.inspectorId, inspectorId), eq(availabilityOverrides.date, dateStr),
    )).all()).filter(o => o.transparency !== 'transparent');
    const synced = overrides.filter(o => o.source != null && !o.isAvailable && o.startTime && o.endTime);
    if (synced.some(o => overlaps(o.startTime!, o.endTime!))) return true;
    const manual = overrides.filter(o => o.source == null);
    if (manual.some(o => !o.isAvailable)) {
        // A manual block leaves only the extra hours on offer; blocked unless one of them holds the window.
        const holds = manual.some(o => o.isAvailable && o.startTime && o.endTime && toMin(o.startTime) <= startMin && endMin <= toMin(o.endTime));
        return !holds;
    }
    return false;
}

/**
 * B-28 compensation — fully retract a booking this request just created: link
 * rows, inspections, then the request row. Only ever called on rows the caller
 * inserted milliseconds ago (the client got a 409, never a confirmation), so
 * hard delete is correct — no cancelled tombstones.
 */
export async function revokeBooking(
    d1: D1Database,
    tenantId: string,
    requestId: string,
): Promise<void> {
    const db = drizzle(d1);
    const rows = await db.select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.tenantId, tenantId), eq(inspections.requestId, requestId)))
        .all();
    const ids = rows.map(r => r.id);
    if (ids.length > 0) {
        await db.delete(inspectionInspectors).where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            inArray(inspectionInspectors.inspectionId, ids),
        ));
        await db.delete(inspections).where(and(
            eq(inspections.tenantId, tenantId),
            inArray(inspections.id, ids),
        ));
    }
    await db.delete(inspectionRequests).where(and(
        eq(inspectionRequests.tenantId, tenantId),
        eq(inspectionRequests.id, requestId),
    ));
}
