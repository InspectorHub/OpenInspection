import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, gte, lte, sql, inArray, isNull, ne } from 'drizzle-orm';
import { availability, availabilityOverrides, inspections, inspectionInspectors, inspectionRequests, serviceInspectors, users, services as servicesTable, agentTenantLinks } from '../lib/db/schema';
import { Errors } from '../lib/errors';
import { safeISODate } from '../lib/date';
import { logger } from '../lib/logger';
import type { HonoConfig } from '../types/hono';
import type { PublicBookingSchema } from '../lib/validations/booking.schema';
import type { z } from '@hono/zod-openapi';
import { createCalendarEvent } from '../api/calendar';
import { getBookingHost, getBaseUrl } from '../lib/url';
import { syncInspectionAssignments } from '../lib/db/assignment-links';
import { INSPECTION_STATUS } from '../lib/status/inspection-status';
import { buildSlotGrid } from '../lib/booking/slot-grid';
import { computeBusyTimes } from '../lib/booking/busy-times';
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

        // If a blocking override exists, no slots available
        const blocked = overrides.some(o => !o.isAvailable);
        const effectiveWindows = blocked ? overrides.filter(o => o.isAvailable) : windows;
        if (effectiveWindows.length === 0) return [];

        // Build 30-minute slot grid from each window
        const slots = buildSlotGrid(effectiveWindows);

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

            const busyTimes = computeBusyTimes(busy.filter(b => b.userId === inspectorId));

            // Collect all time slots from this inspector's effective windows
            const mySlots = buildSlotGrid(effective);

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
        const cmp = (a: Key, b: Key) => a[0] - b[0] || (Number(a[1] > b[1]) - Number(a[1] < b[1]));
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

    /**
     * Booking fulfillment — the single-point-of-review create flow. Extracted
     * byte-identical from the POST /book route handler so the inspection +
     * assignment + agreement + confirmation writes stay one reviewable unit.
     * The route resolves rate-limit + validated body + tenant id, then calls
     * this with the live Hono context; this owns Turnstile/widget-origin
     * enforcement and all fulfillment side effects, returning the same JSON
     * Response the handler used to return.
     */
    async fulfillBooking(
        c: Context<HonoConfig>,
        tenantId: string,
        body: z.infer<typeof PublicBookingSchema>,
    ) {
        const service = c.var.services.booking;

        // Bot Protection — always enforce when secret is configured
        if (c.env.TURNSTILE_SECRET_KEY) {
            if (!body.turnstileToken) throw Errors.Forbidden('Security verification token missing.');
            const isValid = await service.verifyBotProtection(body.turnstileToken, c.env.TURNSTILE_SECRET_KEY);
            if (!isValid) throw Errors.Forbidden('Security verification failed.');
        }

        // B2: when the booking originates from an embedded widget, enforce
        // per-tenant origin allowlist. Non-embed (direct /book visit) submissions
        // are unaffected.
        const isWidgetSubmit = c.req.query('embed') === '1';
        const originHeader = c.req.header('origin');
        if (isWidgetSubmit) {
            const ok = await c.var.services.widget.isOriginAllowed(tenantId, originHeader ?? null);
            if (!ok) {
                await c.var.services.widget.recordEvent(tenantId, 'error', { origin: originHeader, reason: 'origin_not_allowed' });
                throw Errors.Forbidden('Widget submissions from this origin are not allowed for this workspace.');
            }
        }

        const db = drizzle(c.env.DB);

        // UC-A-1 — agent referral attribution. Resolve `?ref=<agentSlug>` (sent
        // through the form as agentRefSlug) to a contacts.id in this tenant.
        // Two requirements both need to hold:
        //   1. A global agent user with that slug exists.
        //   2. They have an `active` agent_tenant_links row for THIS tenant whose
        //      inspectorContactId points at the agent's contact row.
        // Either failure leaves referredByAgentId null — bookings with bad slugs
        // still succeed; we just don't credit the (unknown) agent.
        let resolvedAgentContactId: string | null = null;
        if (body.agentRefSlug) {
            try {
                const agent = await db.select({ id: users.id })
                    .from(users)
                    .where(and(
                        eq(users.slug, body.agentRefSlug),
                        isNull(users.tenantId),
                        eq(users.role, 'agent'),
                    ))
                    .get();
                if (agent) {
                    const link = await db.select({ contactId: agentTenantLinks.inspectorContactId })
                        .from(agentTenantLinks)
                        .where(and(
                            eq(agentTenantLinks.agentUserId, agent.id),
                            eq(agentTenantLinks.tenantId, tenantId),
                            eq(agentTenantLinks.status, 'active'),
                        ))
                        .get();
                    resolvedAgentContactId = link?.contactId ?? null;
                }
            } catch (err) {
                logger.warn('booking.agentRef.resolve.failed', {
                    slug: body.agentRefSlug,
                    tenantId,
                    error: err instanceof Error ? err.message : String(err),
                });
            }
        }

        // IA-26 — inspectorId is now OPTIONAL. The company-level booking page
        // submits without one (pure auto-assign); the legacy per-inspector
        // deep link and the allowInspectorChoice dropdown still send it.
        const serviceIdsForQual = (body.services ?? []).map(s => s.serviceId);
        let inspectorId = body.inspectorId ?? null;

        if (inspectorId) {
            // B-16 — a supplied inspector must belong to the resolved tenant;
            // a mismatched id (tampered payload or stale form) must not reach
            // into another tenant's availability/inspection space.
            const inspectorRow = await db.select({ id: users.id }).from(users)
                .where(and(eq(users.id, inspectorId), eq(users.tenantId, tenantId)))
                .get();
            if (!inspectorRow) throw Errors.NotFound('Inspector not found.');
        }

        // B-16 (company-wide) — distinguish "nobody configured working hours"
        // from a genuinely taken slot, with the honest not-open copy.
        // qualifiedIds is computed once here and threaded through to avoid
        // duplicate getQualifiedInspectorIds lookups in hasAnyHours / getTenantSlots.
        const qualifiedIds = await service.getQualifiedInspectorIds(tenantId, serviceIdsForQual);
        const bookingOpen = await service.hasAnyHours(tenantId, serviceIdsForQual, qualifiedIds);
        if (!bookingOpen) {
            throw Errors.Conflict('Online booking is not open yet. Please contact the company directly to schedule.');
        }

        // Spec 3C / IA-26 — availability enforcement now runs on the tenant
        // aggregation: a slot is bookable iff at least one QUALIFIED inspector
        // is free (or the requested one, when the client chose).
        let requestedTime: string;
        switch (body.timeSlot) {
            case 'morning':   requestedTime = '08:00'; break;
            case 'afternoon': requestedTime = '13:00'; break;
            case 'all-day':   requestedTime = '08:00'; break;
            case 'custom':    requestedTime = body.customTime ?? '08:00'; break;
        }
        // KNOWN RACE (advisory check): the slot read and the inspection insert
        // below are not atomic and D1 offers no row locks, so two concurrent
        // submits for the last slot can both pass and double-book the same
        // inspector (deterministic pickInspector converges on one person).
        // Accepted for launch traffic; a post-insert recheck/compensation is
        // tracked in the backlog. Do NOT "fix" by randomizing the pick — the
        // determinism is intentional (idempotent re-submits).
        const slots = await service.getTenantSlots(tenantId, body.date, serviceIdsForQual, qualifiedIds);
        const target = slots.find(s => s.time === requestedTime);
        const freeIds = (target?.inspectorIds ?? []).filter(id => !inspectorId || id === inspectorId);
        if (freeIds.length === 0) {
            throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
        }
        if (!inspectorId) {
            inspectorId = await service.pickInspector(tenantId, freeIds);
            if (!inspectorId) throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
        }

        // Sprint 2 S2-2 — When the customer selects multiple services, we route
        // through InspectionRequestService so the resulting inspections are
        // grouped under a parent request. The legacy single-service flow still
        // creates a one-inspection request implicitly so dashboards can group
        // every booking the same way.
        const startIso = `${body.date}T${requestedTime}:00Z`;
        const inspectionRequestService = c.var.services.inspectionRequest;
        let createdRequestId: string;
        let primaryInspectionId: string;
        let allInspectionIds: string[] = [];

        if (body.services && body.services.length > 0) {
            const serviceIds = body.services.map(s => s.serviceId);
            const svcRows = await db.select().from(servicesTable)
                .where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, serviceIds)))
                .all();
            if (svcRows.length !== serviceIds.length) {
                throw Errors.BadRequest('One or more services were not found.');
            }
            const subs = svcRows.map(s => {
                const sub: { templateId: string; price: number } = {
                    templateId: s.templateId ?? '',
                    price:      s.price ?? 0,
                };
                if (!sub.templateId) throw Errors.BadRequest(`Service '${s.name}' has no template configured.`);
                return sub;
            });
            const created = await inspectionRequestService.create(tenantId, {
                clientName:      body.clientName,
                clientEmail:     body.clientEmail,
                propertyAddress: body.address,
                scheduledAt:     startIso,
                inspectorId,
                referredByAgentId: resolvedAgentContactId,
            }, subs);
            createdRequestId = created.id;
            allInspectionIds = created.inspections.map(i => i.id);
            primaryInspectionId = allInspectionIds[0] ?? '';
        } else {
            primaryInspectionId = crypto.randomUUID();
            createdRequestId = `req-${primaryInspectionId}`;
            const now = new Date();
            // Quota is consumed AFTER every precondition check above (bot
            // protection, widget origin, inspector ownership, booking-open,
            // slot availability) and BEFORE either row below is inserted —
            // the request row must never be orphaned (created with no
            // inspection behind it) because the tenant hit the cap.
            await this.planQuota?.consumeInspection(tenantId);
            // Insert one-inspection request first so the FK is satisfied.
            await db.insert(inspectionRequests).values({
                id:              createdRequestId,
                tenantId,
                clientName:      body.clientName,
                clientEmail:     body.clientEmail,
                propertyAddress: body.address,
                scheduledAt:     startIso,
                status:          'pending',
                totalAmount:     0,
                paymentStatus:   'unpaid',
                createdAt:       now,
                updatedAt:       now,
            });
            await db.insert(inspections).values({
                id: primaryInspectionId,
                tenantId,
                inspectorId,
                propertyAddress: body.address,
                clientName: body.clientName,
                clientEmail: body.clientEmail,
                // B-28 adjacent fix — store the full start ISO like the
                // multi-service path (inspection-request.service create) does.
                // Busy checks read HH:MM at slice(11,16) of this value; the old
                // bare `body.date` never marked the slot busy, so even
                // sequential double-booking succeeded.
                date: startIso,
                status: INSPECTION_STATUS.REQUESTED,
                paymentStatus: 'unpaid',
                price: 0,
                requestId: createdRequestId,
                referredByAgentId: resolvedAgentContactId,
                createdAt: now
            });
            // DB-8: mirror assignment into inspection_inspectors link table.
            // Non-fatal — the link table is a denormalized mirror; a sync failure
            // must never 500 an anonymous booker whose inspection row already committed.
            try {
                await syncInspectionAssignments(db, tenantId, primaryInspectionId, { inspectorId });
            } catch (e) {
                logger.error('booking.assignment-sync.failed', { inspectionId: primaryInspectionId }, e instanceof Error ? e : undefined);
            }
            allInspectionIds = [primaryInspectionId];
        }
        const inspectionId = primaryInspectionId;

        // B-28 — post-insert TOCTOU recheck. Runs after our insert and BEFORE
        // any side effect (confirmation email, calendar event, notifications)
        // so a losing booker only ever sees the 409, never a confirmation for
        // a booking that then vanishes. The arbitration is deterministic
        // (earliest (createdAt, id) wins), so of two racers exactly one
        // self-compensates here while the other proceeds untouched.
        const verdict = await service.arbitrateSlotRace(
            tenantId, inspectorId!, body.date, requestedTime, createdRequestId,
        );
        if (verdict === 'lose') {
            await service.revokeBooking(tenantId, createdRequestId);
            throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
        }

        // IA-18 (#111) — capture the booker as a Client contact and link it to
        // ALL inspections this booking created so their client appears in
        // Contacts and on the inspection hub People card.
        //
        // Placement: AFTER arbitration. A losing booker self-revokes and throws
        // above, so we never stamp a contact onto inspections that were just
        // deleted. (A stray contact row is harmless on its own — what we avoid
        // is a clientContactId pointing at vanished inspections.) It also runs
        // BEFORE the side-effect block to keep the synchronous DB writes
        // grouped before async waitUntil work.
        //
        // Non-fatal: a booking must NEVER fail because of contact bookkeeping.
        // Any error is logged (NO client email — only inspection ids + message)
        // and swallowed; the inspection rows already committed regardless.
        let bookingClientContactId: string | null = null;
        if (body.clientEmail || body.clientName) {
            try {
                const { id: clientContactId } = await c.var.services.contact.upsertClientContact(tenantId, {
                    name:  body.clientName,
                    email: body.clientEmail,
                    type:  'client',
                });
                bookingClientContactId = clientContactId;
                await db.update(inspections)
                    .set({ clientContactId })
                    .where(and(
                        inArray(inspections.id, allInspectionIds),
                        eq(inspections.tenantId, tenantId),
                    ));
            } catch (e) {
                logger.warn('booking.client-contact.upsert.failed', {
                    inspectionIds: allInspectionIds,
                    error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // Track L (D6, path A) — self-book SMS opt-in. The checkbox is unchecked by
        // default; when ticked we record a `granted` consent event (captured_via=
        // booking_form) keyed on the client contact. Non-fatal: a consent write must
        // never fail the booking (the inspection rows already committed).
        if (body.smsOptin && bookingClientContactId) {
            try {
                const { SmsConsentService } = await import('./sms-consent.service');
                await new SmsConsentService(c.env.DB).record(
                    tenantId, bookingClientContactId, 'granted', 'booking_form',
                    { ip: c.req.header('CF-Connecting-IP'), userAgent: c.req.header('User-Agent') },
                );
            } catch (e) {
                logger.warn('booking.sms-optin.record.failed', {
                    inspectionId, error: e instanceof Error ? e.message : String(e),
                });
            }
        }

        // Sprint 1 C-6 — map window option to a human-readable label for the
        // calendar event + confirmation email.
        const windowLabel: Record<typeof body.timeSlot, string> = {
            'morning':   'Morning (8:00 AM – 12:00 PM)',
            'afternoon': 'Afternoon (12:00 PM – 4:00 PM)',
            'all-day':   'All day (8:00 AM – 5:00 PM)',
            'custom':    body.customTime ? `${body.customTime}` : 'Custom time',
        };

        // Async tasks
        c.executionCtx.waitUntil((async () => {
            const inspector = await db.select().from(users).where(eq(users.id, inspectorId!)).get();
            if (inspector?.googleRefreshToken && inspector?.googleCalendarId) {
                const startDateTime = `${body.date}T${requestedTime}:00Z`;
                await createCalendarEvent(
                    c.env.GOOGLE_CLIENT_ID,
                    c.env.GOOGLE_CLIENT_SECRET,
                    inspector.googleRefreshToken,
                    inspector.googleCalendarId,
                    `Inspection: ${body.address}`,
                    startDateTime,
                    body.address
                ).catch(e => logger.error('Calendar sync failed', {}, e instanceof Error ? e : undefined));
            }

            const emailService = c.var.services.email;

            // Sprint 1 C-10 — build the ICS event so the confirmation email
            // carries a calendar invite the customer can import into Apple
            // Calendar / Google Calendar. Duration defaults to 3 hours, with
            // 4 hours for morning/afternoon windows and 9 hours for all-day.
            const startMs = new Date(`${body.date}T${requestedTime}:00Z`).getTime();
            let durationHours: number;
            switch (body.timeSlot) {
                case 'all-day':   durationHours = 9; break;
                case 'morning':
                case 'afternoon': durationHours = 4; break;
                default:          durationHours = 3; break;
            }
            const endMs = startMs + durationHours * 60 * 60 * 1000;
            // Booking-confirmation greeting falls back to the brand, never the
            // inspector's inbox — keeps the email looking professional even if a
            // legacy account is missing a display name.
            const inspectorName = inspector?.name || c.env.APP_NAME || 'Your inspector';
            const inspectorEmail = inspector?.email || c.env.SENDER_EMAIL || `noreply@${c.env.APP_NAME?.toLowerCase().replace(/\s/g, '') || 'inspector'}.com`;

            // Sprint B-4a — append inspector signature so customers can rebook
            // with the same inspector via the per-inspector booking link.
            const sigInspector = inspector ? {
                name:          inspector.name ?? null,
                email:         inspector.email ?? null,
                phone:         inspector.phone ?? null,
                licenseNumber: inspector.licenseNumber ?? null,
                slug:          inspector.slug ?? null,
            } : undefined;
            // Track L (D6, path B) — double-opt-in link injected at the RENDERER
            // level (not gated on any automation rule) so disabling a rule never
            // removes the only opt-in path. The token self-describes (tenant,
            // contact) — see lib/sms/optin-token.ts. Best-effort: a token failure
            // simply omits the link.
            let smsOptinUrl: string | undefined;
            if (bookingClientContactId && c.env.JWT_SECRET) {
                try {
                    const { mintOptinToken } = await import('../lib/sms/optin-token');
                    const token = await mintOptinToken(tenantId, bookingClientContactId, c.env.JWT_SECRET);
                    smsOptinUrl = `${getBaseUrl(c)}/sms-optin/${encodeURIComponent(token)}`;
                } catch (e) {
                    logger.warn('booking.sms-optin.mint.failed', { inspectionId, error: e instanceof Error ? e.message : String(e) });
                }
            }

            await emailService.sendBookingConfirmation(
                body.clientEmail,
                body.clientName,
                body.address,
                body.date,
                windowLabel[body.timeSlot],
                {
                    uid:            `inspection-${inspectionId}`,
                    summary:        `Home Inspection at ${body.address}`,
                    description:    `Inspector: ${inspectorName}\nWindow: ${windowLabel[body.timeSlot]}\n\nWe will send your detailed report within 24 hours of completion.`,
                    location:       body.address,
                    start:          new Date(startMs),
                    end:            new Date(endMs),
                    organizerEmail: inspectorEmail,
                    organizerName:  inspectorName,
                },
                sigInspector,
                getBookingHost(c),
                smsOptinUrl,
            ).catch(e => logger.error('Booking confirmation email failed', {}, e instanceof Error ? e : undefined));
        })());

        if (isWidgetSubmit) {
            c.executionCtx.waitUntil(
                c.var.services.widget.recordEvent(tenantId, 'success', { origin: originHeader, inspectionId })
            );
        }

        // B3: in-app notification for the inspector workspace
        c.executionCtx.waitUntil(
            c.var.services.notification.createForAllAdmins(tenantId, {
                type: 'booking.received',
                title: `New booking — ${body.address ?? 'no address'}`,
                body: body.clientName ? `From ${body.clientName}` : null,
                entityType: 'inspection',
                entityId: inspectionId,
                metadata: { source: isWidgetSubmit ? 'widget' : 'public_form' },
            })
        );

        return c.json({
            success: true,
            data: {
                success: true,
                inspectionId,
                requestId: createdRequestId,
                inspectionIds: allInspectionIds,
            }
        }, 200);
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
        await db.delete(availabilityOverrides).where(and(eq(availabilityOverrides.id, id), eq(availabilityOverrides.tenantId, tenantId)));
    }
}
