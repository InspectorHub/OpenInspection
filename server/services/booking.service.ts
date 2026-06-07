import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, sql, inArray, isNull, ne } from 'drizzle-orm';
import { availability, availabilityOverrides, inspections, inspectionInspectors, inspectionRequests, serviceInspectors, users } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import { logger } from '../lib/logger';

/**
 * Service to handle public booking flow and availability lookups.
 */
export class BookingService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Lists all active inspectors for a tenant.
     */
    async listInspectors(tenantId: string) {
        const db = this.getDrizzle();
        const rows = await db.select({ id: users.id, email: users.email })
            .from(users)
            .where(and(eq(users.tenantId, tenantId), eq(users.role, 'inspector')))
            .all();
            
        return rows.map(r => ({
            id: r.id,
            name: r.email.split('@')[0] // Use email prefix as name since name field is missing
        }));
    }

    /**
     * Fetches the availability profile for an inspector.
     */
    async getAvailability(tenantId: string, inspectorId: string, startDate: string, endDate: string) {
        const db = this.getDrizzle();
        
        const [recurring, overrides, jobs] = await Promise.all([
            db.select().from(availability).where(and(eq(availability.tenantId, tenantId), eq(availability.inspectorId, inspectorId))).all(),
            db.select().from(availabilityOverrides).where(and(
                eq(availabilityOverrides.tenantId, tenantId),
                eq(availabilityOverrides.inspectorId, inspectorId),
                gte(availabilityOverrides.date, startDate),
                lte(availabilityOverrides.date, endDate)
            )).all(),
            db.select({ date: inspections.date }).from(inspections).where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspections.inspectorId, inspectorId),
                gte(inspections.date, startDate),
                lte(inspections.date, endDate)
            )).all()
        ]);

        return { 
            baseAvailability: recurring, 
            overrides, 
            bookedSlots: jobs.map(j => j.date) 
        };
    }

    /**
     * Returns computed time slots for a given inspector/date.
     * Reads recurring availability windows, date overrides, and existing bookings.
     *
     * LEGACY (lead-only busy check via inspections.inspectorId): no production caller —
     * the live booking path uses getTenantSlots, whose link-table busy check also counts
     * helper assignments. Prefer getTenantSlots for new code.
     */
    async getAvailableSlots(
        tenantId: string,
        inspectorId: string,
        dateStr: string,
    ): Promise<Array<{ time: string; available: boolean }>> {
        const db = this.getDrizzle();
        const date = new Date(dateStr + 'T00:00:00');
        const dayOfWeek = date.getDay();

        const [windows, overrides, existingInsp] = await Promise.all([
            db.select().from(availability).where(and(
                eq(availability.tenantId, tenantId),
                eq(availability.inspectorId, inspectorId),
                eq(availability.dayOfWeek, dayOfWeek),
            )).all(),
            db.select().from(availabilityOverrides).where(and(
                eq(availabilityOverrides.tenantId, tenantId),
                eq(availabilityOverrides.inspectorId, inspectorId),
                eq(availabilityOverrides.date, dateStr),
            )).all(),
            db.select({ date: inspections.date }).from(inspections).where(and(
                eq(inspections.tenantId, tenantId),
                eq(inspections.inspectorId, inspectorId),
                sql`date(${inspections.date}) = ${dateStr}`,
                sql`${inspections.status} not in ('cancelled')`,
            )).all(),
        ]);

        // If a blocking override exists, no slots available
        const blocked = overrides.some(o => !o.isAvailable);
        const effectiveWindows = blocked ? overrides.filter(o => o.isAvailable) : windows;
        if (effectiveWindows.length === 0) return [];

        // Build 30-minute slot grid from each window
        const slots: string[] = [];
        for (const w of effectiveWindows) {
            const start = w.startTime ?? '08:00';
            const end   = w.endTime   ?? '17:00';
            let current = start;
            while (current < end) {
                if (!slots.includes(current)) slots.push(current);
                const [h, m] = current.split(':').map(Number);
                const next = new Date(0, 0, 0, h, m + 30);
                current = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
            }
        }

        const busyTimes = new Set(existingInsp.map(i => String(i.date).slice(11, 16)));
        return slots.map(time => ({ time, available: !busyTimes.has(time) }));
    }

    /**
     * IA-26 — staff eligible to run the given services. Base set = every
     * non-deleted tenant user except global agents (availability is the real
     * bookability signal: office staff who never configure hours simply never
     * yield slots). service_inspectors rows RESTRICT per service; zero rows
     * for a service = everyone qualifies. Multi-service bookings intersect.
     */
    async getQualifiedInspectorIds(tenantId: string, serviceIds: string[]): Promise<string[]> {
        const db = this.getDrizzle();
        const staff = await db.select({ id: users.id }).from(users)
            .where(and(eq(users.tenantId, tenantId), isNull(users.deletedAt), ne(users.role, 'agent')))
            .all();
        let ids = staff.map(s => s.id);
        if (serviceIds.length === 0 || ids.length === 0) return ids;
        const quals = await db.select().from(serviceInspectors)
            .where(and(eq(serviceInspectors.tenantId, tenantId), inArray(serviceInspectors.serviceId, serviceIds)))
            .all();
        for (const sid of serviceIds) {
            const allowed = quals.filter(q => q.serviceId === sid).map(q => q.userId);
            if (allowed.length > 0) ids = ids.filter(id => allowed.includes(id));
        }
        return ids;
    }

    /**
     * True iff at least one qualified staff member has recurring hours.
     * @param qualifiedIds Optional precomputed result of getQualifiedInspectorIds to avoid duplicate lookups.
     */
    async hasAnyHours(tenantId: string, serviceIds: string[], qualifiedIds?: string[]): Promise<boolean> {
        const db = this.getDrizzle();
        const qualified = qualifiedIds ?? await this.getQualifiedInspectorIds(tenantId, serviceIds);
        if (qualified.length === 0) return false;
        const row = await db.select({ id: availability.id }).from(availability)
            .where(and(eq(availability.tenantId, tenantId), inArray(availability.inspectorId, qualified)))
            .limit(1).get();
        return !!row;
    }

    /**
     * IA-26 aggregation layer — the union of qualified inspectors' bookable
     * slots for one date. A slot is available iff at least one qualified
     * inspector (a) has it inside a weekly window, (b) has no blocking
     * override that date, and (c) has no inspection at that time (via the
     * inspection_inspectors link table, so helper assignments count as busy
     * too). Storage stays per-inspector; this only changes the query face.
     * @param qualifiedIds Optional precomputed result of getQualifiedInspectorIds to avoid duplicate lookups.
     */
    async getTenantSlots(
        tenantId: string,
        dateStr: string,
        serviceIds: string[],
        qualifiedIds?: string[],
    ): Promise<Array<{ time: string; available: boolean; inspectorIds: string[] }>> {
        const db = this.getDrizzle();
        const qualified = qualifiedIds ?? await this.getQualifiedInspectorIds(tenantId, serviceIds);
        if (qualified.length === 0) return [];
        const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();

        const [windows, overrides, busy] = await Promise.all([
            db.select().from(availability).where(and(
                eq(availability.tenantId, tenantId),
                inArray(availability.inspectorId, qualified),
                eq(availability.dayOfWeek, dayOfWeek),
            )).all(),
            db.select().from(availabilityOverrides).where(and(
                eq(availabilityOverrides.tenantId, tenantId),
                inArray(availabilityOverrides.inspectorId, qualified),
                eq(availabilityOverrides.date, dateStr),
            )).all(),
            db.select({ userId: inspectionInspectors.userId, date: inspections.date })
                .from(inspectionInspectors)
                .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
                .where(and(
                    eq(inspectionInspectors.tenantId, tenantId),
                    inArray(inspectionInspectors.userId, qualified),
                    sql`date(${inspections.date}) = ${dateStr}`,
                    sql`${inspections.status} not in ('cancelled')`,
                )).all(),
        ]);

        // slotMap: time -> set of free inspector ids (inspectors WITH a window but NOT busy at that time)
        const slotMap = new Map<string, Set<string>>();

        for (const inspectorId of qualified) {
            const myWindows = windows.filter(w => w.inspectorId === inspectorId);
            const myOverrides = overrides.filter(o => o.inspectorId === inspectorId);
            const blocked = myOverrides.some(o => !o.isAvailable);
            const effective = blocked ? myOverrides.filter(o => o.isAvailable) : myWindows;
            if (effective.length === 0) continue;

            const busyTimes = new Set(
                busy.filter(b => b.userId === inspectorId).map(b => String(b.date).slice(11, 16)),
            );

            // Collect all time slots from this inspector's effective windows
            const mySlots: string[] = [];
            for (const w of effective) {
                let current = w.startTime ?? '08:00';
                const end = w.endTime ?? '17:00';
                while (current < end) {
                    if (!mySlots.includes(current)) mySlots.push(current);
                    const [h, m] = current.split(':').map(Number);
                    const next = new Date(0, 0, 0, h, m + 30);
                    current = `${String(next.getHours()).padStart(2, '0')}:${String(next.getMinutes()).padStart(2, '0')}`;
                }
            }

            for (const time of mySlots) {
                if (!slotMap.has(time)) slotMap.set(time, new Set());
                if (!busyTimes.has(time)) {
                    slotMap.get(time)!.add(inspectorId);
                }
            }
        }

        return [...slotMap.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([time, ids]) => ({ time, available: ids.size > 0, inspectorIds: [...ids].sort() }));
    }

    /**
     * Deterministic auto-assignment — "first available": stable sort by
     * (name, id) over the free set so repeated submissions pick the same
     * person (Spectora's seniority-order analogue without a rank field).
     */
    async pickInspector(tenantId: string, freeIds: string[]): Promise<string | null> {
        if (freeIds.length === 0) return null;
        const db = this.getDrizzle();
        const rows = await db.select({ id: users.id, name: users.name }).from(users)
            .where(and(eq(users.tenantId, tenantId), inArray(users.id, freeIds))).all();
        rows.sort((a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id));
        return rows[0]?.id ?? null;
    }

    /**
     * B-28 — post-insert TOCTOU arbitration. The slot read and the inspection
     * insert in POST /book are not atomic (D1 has no row locks), so two
     * concurrent submits can both pass the advisory check and double-book the
     * same inspector. Instead of preventing the race we resolve it after the
     * fact: every racer calls this AFTER its own insert and BEFORE any side
     * effect (emails, calendar). All racers see the same conflicting rows and
     * apply the same deterministic order — sort by (createdAt, id) — so the
     * earliest booking wins and every later racer self-compensates
     * (revokeBooking + 409). Exactly one winner, no coordination needed.
     *
     * Busy semantics mirror getTenantSlots: link-table join, non-cancelled,
     * HH:MM read from the ISO datetime at slice(11,16).
     */
    async arbitrateSlotRace(
        tenantId: string,
        inspectorId: string,
        dateStr: string,
        time: string,
        myRequestId: string,
    ): Promise<'win' | 'lose'> {
        const db = this.getDrizzle();
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
        const cmp = (a: Key, b: Key) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0);
        const myKey    = mine.map(key).sort(cmp)[0]!;
        const otherKey = others.map(key).sort(cmp)[0]!;
        return cmp(otherKey, myKey) < 0 ? 'lose' : 'win';
    }

    /**
     * B-28 compensation — fully retract a booking this request just created:
     * link rows, inspections, then the request row. Only ever called on rows
     * the caller inserted milliseconds ago (the client got a 409, never a
     * confirmation), so hard delete is correct — no cancelled tombstones.
     */
    async revokeBooking(tenantId: string, requestId: string): Promise<void> {
        const db = this.getDrizzle();
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

    /**
     * Internal helper to verify bot protection (Turnstile).
     */
    async verifyBotProtection(token: string, secret: string) {
        try {
            const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ secret, response: token }),
            });
            const data = await res.json() as { success: boolean };
            return data.success;
        } catch (e) {
            logger.error('[bot-protection] Turnstile verification failed', {}, e instanceof Error ? e : undefined);
            return false;
        }
    }
}

/**
 * Service to manage internal inspector availability schedules.
 */
export class AvailabilityService {
    constructor(private db: D1Database) {}

    private getDrizzle() {
        return drizzle(this.db);
    }

    /**
     * Replaces the entire weekly schedule for an inspector.
     */
    async updateWeeklySchedule(tenantId: string, inspectorId: string, slots: { dayOfWeek: number; startTime: string; endTime: string }[]) {
        const db = this.getDrizzle();
        
        await db.delete(availability).where(and(
            eq(availability.tenantId, tenantId),
            eq(availability.inspectorId, inspectorId)
        ));

        if (slots.length > 0) {
            await db.insert(availability).values(
                slots.map(s => ({
                    id: crypto.randomUUID(),
                    tenantId,
                    inspectorId,
                    dayOfWeek: s.dayOfWeek,
                    startTime: s.startTime,
                    endTime: s.endTime,
                    createdAt: new Date(),
                }))
            );
        }
    }

    /**
     * Adds a specific availability override.
     */
    async addOverride(tenantId: string, data: {
        inspectorId: string;
        date: string;
        isAvailable: boolean;
        startTime?: string | null | undefined;
        endTime?: string | null | undefined;
    }) {
        const db = this.getDrizzle();
        const newOverride = {
            id: crypto.randomUUID(),
            tenantId,
            inspectorId: data.inspectorId,
            date: data.date,
            isAvailable: data.isAvailable,
            startTime: data.startTime || null,
            endTime: data.endTime || null,
            createdAt: new Date(),
        };

        await db.insert(availabilityOverrides).values(newOverride);
        return {
            ...newOverride,
            createdAt: safeISODate(newOverride.createdAt)
        };
    }

    /**
     * Deletes an availability override.
     */
    async deleteOverride(tenantId: string, id: string) {
        const db = this.getDrizzle();
        const existing = await db.select().from(availabilityOverrides).where(and(
            eq(availabilityOverrides.id, id),
            eq(availabilityOverrides.tenantId, tenantId)
        )).get();

        if (!existing) throw Errors.NotFound('Override not found');
        await db.delete(availabilityOverrides).where(eq(availabilityOverrides.id, id));
    }
}
