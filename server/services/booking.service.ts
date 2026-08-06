import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, sql, inArray, isNull, ne } from 'drizzle-orm';
import { availability, availabilityOverrides, calendarBlocks, inspections, inspectionInspectors, serviceInspectors, users } from '../lib/db/schema';
import { logger } from '../lib/logger';
import type { HonoConfig } from '../types/hono';
import type { PublicBookingSchema } from '../lib/validations/booking.schema';
import type { z } from '@hono/zod-openapi';
import { buildSlotGrid } from '../lib/booking/slot-grid';
import { loadSlotGridOptions } from '../lib/booking/slot-rules';
import { computeBusyTimes } from '../lib/booking/busy-times';
import { buildTenantSlotMap } from '../lib/booking/tenant-slot-map';
import { resolvePublicHolidayEffect } from '../lib/holidays/load-tenant-holidays';
import { fulfillBooking as runFulfillBooking } from './booking/fulfill-booking';
import {
    arbitrateSlotRace as runArbitrateSlotRace,
    revokeBooking as runRevokeBooking,
} from './booking/slot-arbitration';
import {
    routeInspector as runRouteInspector,
    type RouteInspectorOptions,
} from './booking/route-inspector';
import type { RoutingDecision } from '../lib/booking/routing';
import { filterEligibleInspectors, loadServiceAreasByUser, type EligibilitySkipReason } from '../lib/booking/eligibility';
import { applyBookingRules, loadBookingRules } from '../lib/booking/booking-rules';
import type { PlanQuotaGuard } from '../features/plan-quota/guard';
/**
 * Service to handle public booking flow and availability lookups.
 */
export class BookingService {
    /**
     * Free-tier usage-quota guard (optional). Present only in SaaS deploys
     * with `hasUsageQuota` (see deployment-profile.ts); undefined in
     * standalone, where booking creation stays unlimited. Only the
     * legacy single-service branch of `fulfillBooking` consumes directly —
     * the multi-service branch delegates to InspectionRequestService.create,
     * which carries its own guard and consumes once per sub-inspection.
     */
    constructor(private db: D1Database, private planQuota?: PlanQuotaGuard) {}

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

        // If a blocking override exists, no slots available. Transparent (free)
        // Google events are stored as overrides but never block (A-polish 10).
        const blocked = overrides.some(o => !o.isAvailable && o.transparency !== 'transparent');
        const effectiveWindows = blocked ? overrides.filter(o => o.isAvailable) : windows;
        if (effectiveWindows.length === 0) return [];

        const gridOpts = await loadSlotGridOptions(this.db, tenantId);
        const slots = buildSlotGrid(effectiveWindows, gridOpts);

        const busyTimes = computeBusyTimes(existingInsp);
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
     * Geographic eligibility runs BEFORE the union (an inspector who will not
     * travel to this ZIP should never contribute a slot), and the tenant
     * booking rules run AFTER it (they mark computed slots unbookable). Both
     * report why they did nothing — `geoSkipped` / `rulesActive` are on the
     * return value precisely so "the filter degraded gracefully" can never
     * again be indistinguishable from "the filter ran".
     *
     * @param qualifiedIds Optional precomputed result of getQualifiedInspectorIds to avoid duplicate lookups.
     * @param propertyZip  The property's ZIP when the booking carries one.
     */
    async getTenantSlots(
        tenantId: string,
        dateStr: string,
        serviceIds: string[],
        qualifiedIds?: string[],
        propertyZip?: string | null,
    ): Promise<{
        slots: Array<{ time: string; available: boolean; inspectorIds: string[] }>;
        holidayAdvisory?: { date: string; name: string };
        /** Set when the ZIP filter could NOT run; null when it did. */
        geoSkipped?: EligibilitySkipReason | null;
        /** True when the ZIP filter ran and left nobody serving this area. */
        outsideServiceArea?: boolean;
    }> {
        const holiday = await resolvePublicHolidayEffect(this.db, tenantId, dateStr);
        if (holiday.effect === 'block') {
            return { slots: [] };
        }

        const db = this.getDrizzle();
        const qualified = qualifiedIds ?? await this.getQualifiedInspectorIds(tenantId, serviceIds);
        const advisory = holiday.effect === 'advisory' && holiday.name
            ? { holidayAdvisory: { date: dateStr, name: holiday.name } }
            : {};
        if (qualified.length === 0) return { slots: [], ...advisory };

        const geo = filterEligibleInspectors(
            qualified,
            propertyZip ?? null,
            await loadServiceAreasByUser(this.db, tenantId, qualified),
        );
        if (geo.reason) {
            logger.info('booking.eligibility.not-applied', { tenantId, reason: geo.reason });
        }
        if (geo.excludedEveryone) {
            return { slots: [], ...advisory, geoSkipped: null, outsideServiceArea: true };
        }
        const eligible = geo.eligibleIds;
        const reported = { geoSkipped: geo.reason, outsideServiceArea: false };
        const dayOfWeek = new Date(dateStr + 'T00:00:00').getDay();

        const [windows, overrides, busy, blocks] = await Promise.all([
            db.select().from(availability).where(and(
                eq(availability.tenantId, tenantId),
                inArray(availability.inspectorId, eligible),
                eq(availability.dayOfWeek, dayOfWeek),
            )).all(),
            db.select().from(availabilityOverrides).where(and(
                eq(availabilityOverrides.tenantId, tenantId),
                inArray(availabilityOverrides.inspectorId, eligible),
                eq(availabilityOverrides.date, dateStr),
            )).all(),
            db.select({ userId: inspectionInspectors.userId, date: inspections.date })
                .from(inspectionInspectors)
                .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
                .where(and(
                    eq(inspectionInspectors.tenantId, tenantId),
                    inArray(inspectionInspectors.userId, eligible),
                    sql`date(${inspections.date}) = ${dateStr}`,
                    sql`${inspections.status} not in ('cancelled')`,
                )).all(),
            db.select().from(calendarBlocks).where(and(
                eq(calendarBlocks.tenantId, tenantId),
                inArray(calendarBlocks.userId, eligible),
                eq(calendarBlocks.date, dateStr),
            )).all(),
        ]);

        const gridOpts = await loadSlotGridOptions(this.db, tenantId);
        const slotMap = buildTenantSlotMap(eligible, windows, overrides, busy, blocks, gridOpts);
        const rules = await loadBookingRules(this.db, tenantId);

        const slots = [...slotMap.entries()]
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([time, ids]) => {
                // Lead time and same-day cutoff mark an otherwise-free slot
                // unbookable. Applied here rather than inside the grid builder
                // so the reason stays a property of the tenant's POLICY, not of
                // anyone's calendar.
                const blocked = rules.inactive ? false : !applyBookingRules({
                    ...rules, civilDate: dateStr, slotTime: time, nowMs: Date.now(),
                }).allowed;
                return {
                    time,
                    available: !blocked && ids.size > 0,
                    inspectorIds: blocked ? [] : [...ids].sort(),
                };
            });

        return { slots, ...advisory, ...reported };
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
     * Strategy-aware auto-assignment. Returns the DECISION, not just an id:
     * `least_loaded` and `closest` can be inapplicable to a request, and the
     * substitution has to be visible to the caller so it reaches the audit
     * record. See `./booking/route-inspector`.
     */
    async routeInspector(
        tenantId: string,
        freeIds: string[],
        opts: RouteInspectorOptions,
    ): Promise<RoutingDecision> {
        return runRouteInspector(this.db, tenantId, freeIds, opts);
    }

    /** B-28 post-insert TOCTOU arbitration — see `./booking/slot-arbitration`. */
    async arbitrateSlotRace(
        tenantId: string,
        inspectorId: string,
        dateStr: string,
        time: string,
        myRequestId: string,
    ): Promise<'win' | 'lose'> {
        return runArbitrateSlotRace(this.db, tenantId, inspectorId, dateStr, time, myRequestId);
    }

    /** B-28 compensation — see `./booking/slot-arbitration`. */
    async revokeBooking(tenantId: string, requestId: string): Promise<void> {
        return runRevokeBooking(this.db, tenantId, requestId);
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

    /**
     * Booking fulfillment — the single-point-of-review create flow. Extracted
     * byte-identical from the POST /book route handler so the inspection +
     * assignment + agreement + confirmation writes stay one reviewable unit.
     * The route resolves rate-limit + validated body + tenant id, then calls
     * this with the live Hono context; this owns Turnstile/widget-origin
     * enforcement and all fulfillment side effects, returning the same JSON
     * Response the handler used to return.
     */
    /**
     * Public booking fulfilment. The body lives in `./booking/fulfill-booking`
     * and its three neighbours — admission, people, confirmation. It stays a
     * method here because every caller and six specs reach it as
     * `c.var.services.booking.fulfillBooking(...)`, and because the free
     * function needs the handles this instance was constructed with.
     */
    async fulfillBooking(
        c: Context<HonoConfig>,
        tenantId: string,
        body: z.infer<typeof PublicBookingSchema>,
    ) {
        return runFulfillBooking({ d1: this.db, planQuota: this.planQuota }, c, tenantId, body);
    }
}
