import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { inspections, inspectionInspectors, inspectionRequests } from '../../lib/db/schema';

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
 * conflicting rows and apply the same deterministic order — sort by
 * (createdAt, id) — so the earliest booking wins and every later racer
 * self-compensates (revokeBooking + 409). Exactly one winner, no coordination.
 *
 * Busy semantics mirror getTenantSlots: link-table join, non-cancelled, HH:MM
 * read from the ISO datetime at slice(11,16).
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
    })
        .from(inspectionInspectors)
        .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
        .where(and(
            eq(inspectionInspectors.tenantId, tenantId),
            eq(inspectionInspectors.userId, inspectorId),
            sql`date(${inspections.date}) = ${dateStr}`,
            sql`${inspections.status} not in ('cancelled')`,
        )).all();

    const atSlot = rows.filter(r => String(r.date).slice(11, 16) === time);
    const mine   = atSlot.filter(r => r.requestId === myRequestId);
    const others = atSlot.filter(r => r.requestId !== myRequestId);
    // No competitor — or our rows are not visible (nothing to arbitrate).
    if (mine.length === 0 || others.length === 0) return 'win';

    type Key = [number, string];
    const key = (r: typeof rows[number]): Key => [
        r.createdAt instanceof Date ? r.createdAt.getTime() : Number(r.createdAt ?? 0),
        r.inspectionId,
    ];
    const cmp = (a: Key, b: Key) => a[0] - b[0] || (Number(a[1] > b[1]) - Number(a[1] < b[1]));
    const myKey    = mine.map(key).sort(cmp)[0]!;
    const otherKey = others.map(key).sort(cmp)[0]!;
    return cmp(otherKey, myKey) < 0 ? 'lose' : 'win';
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
