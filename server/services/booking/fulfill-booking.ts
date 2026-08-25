import type { Context } from 'hono';
import { drizzle } from 'drizzle-orm/d1';
import { eq, and, inArray } from 'drizzle-orm';
import { inspections, inspectionRequests, tenantConfigs, services as servicesTable } from '../../lib/db/schema';
import { wallClockToEpochMs, resolveTenantTimeZone } from '../../lib/tz';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { writeAuditLogWithSlug } from '../../lib/audit';
import { fireAutomation } from '../inspection/shared';
import { syncInspectionAssignments } from '../../lib/db/assignment-links';
import { INSPECTION_STATUS } from '../../lib/status/inspection-status';
import { admitBooking } from './booking-admission';
import { resolveBookingAgentReferral, attachBookingPeople } from './booking-people';
import { dispatchBookingConfirmation } from './booking-confirmation';
import { resolveBookingDepositCents, snapshotOrderDeposit } from './deposit';
import type { HonoConfig } from '../../types/hono';
import type { PublicBookingSchema } from '../../lib/validations/booking.schema';
import type { PlanQuotaGuard } from '../../features/plan-quota/guard';
import type { z } from '@hono/zod-openapi';

/**
 * The BookingService instance's own runtime deps. Passed rather than read off
 * `c.env`: `d1` is the handle the service was CONSTRUCTED with, which unit
 * tests deliberately make different from `c.env.DB`.
 */
export interface FulfillBookingDeps {
    d1: D1Database;
    planQuota?: PlanQuotaGuard | undefined;
}

/**
 * Turn an accepted public booking into rows, and defend them.
 *
 * What is left here after the three extractions is exactly the part that
 * WRITES and the part that has to clean up after itself: the request +
 * inspection rows (two branches, multi-service via InspectionRequestService and
 * the legacy single-service direct insert), the post-insert race arbitration
 * that may have to revoke what was just written, and the scheduled-instant
 * stamp over the whole set. Those three cannot be separated — the arbitration
 * only means anything against rows this function created, and the stamp only
 * runs on the survivors.
 *
 * The neighbours are `./booking-admission` (everything before the first write),
 * `./booking-people` (who the booking is for), and `./booking-confirmation`
 * (what the world hears afterwards).
 */
export async function fulfillBooking(
    deps: FulfillBookingDeps,
    c: Context<HonoConfig>,
    tenantId: string,
    body: z.infer<typeof PublicBookingSchema>,
) {
    const service = c.var.services.booking;
    const db = drizzle(c.env.DB);

    const { inspectorId, requestedTime, isWidgetSubmit, originHeader, place, routing } =
        await admitBooking(c, db, deps.d1, tenantId, body);

    const resolvedAgentContactId = await resolveBookingAgentReferral(db, tenantId, body.agentRefSlug);

    // Sprint 2 S2-2 — When the customer selects multiple services, we route
    // through InspectionRequestService so the resulting inspections are
    // grouped under a parent request. The legacy single-service flow still
    // creates a one-inspection request implicitly so dashboards can group
    // every booking the same way.
    const startIso = `${body.date}T${requestedTime}:00Z`;
    const inspectionRequestService = c.var.services.inspectionRequest;
    let createdRequestId: string;
    let primaryInspectionId: string;
    let allInspectionIds: string[];
    // Task 7b (people-role-profiles) — set only by the direct-insert
    // (legacy single-service) branch below. The multi-service branch
    // routes through InspectionRequestService.create, which owns its
    // own inspection_people write for the inspections it creates.
    let directInsertInspectionId: string | null = null;
    // Booked duration from the chosen service(s); NULL when the legacy path
    // carries no explicit service (falls back to the time-slot window below).
    let bookedServiceDurationMin: number | null = null;

    if (body.services && body.services.length > 0) {
        const serviceIds = body.services.map(s => s.serviceId);
        const svcRows = await db.select().from(servicesTable)
            .where(and(eq(servicesTable.tenantId, tenantId), inArray(servicesTable.id, serviceIds)))
            .all();
        if (svcRows.length !== serviceIds.length) {
            throw Errors.BadRequest('One or more services were not found.');
        }
        // Total booked minutes across the selected services (back-to-back);
        // NULL when none carry a duration, so the time-slot window is used.
        bookedServiceDurationMin =
            svcRows.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0) || null;
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
        // Quota is consumed AFTER every precondition check in admitBooking (bot
        // protection, widget origin, inspector ownership, booking-open,
        // slot availability) and BEFORE either row below is inserted —
        // the request row must never be orphaned (created with no
        // inspection behind it) because the tenant hit the cap.
        await deps.planQuota?.consumeInspection(tenantId);
        // Insert one-inspection request first so the FK is satisfied.
        await db.insert(inspectionRequests).values({
            id:              createdRequestId,
            tenantId,
            clientName:      body.clientName,
            clientEmail:     body.clientEmail,
            propertyAddress: body.address,
            // The request row has carried property_zip since it was created and
            // the public form never filled it. It does now.
            propertyCity:    place?.city ?? null,
            propertyState:   place?.state ?? null,
            propertyZip:     place?.zip ?? body.addressZip ?? null,
            scheduledAt:     new Date(startIso),
            status:          'pending',
            createdAt:       now,
            updatedAt:       now,
        });
        await db.insert(inspections).values({
            id: primaryInspectionId,
            tenantId,
            inspectorId,
            propertyAddress: body.address,
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
        directInsertInspectionId = primaryInspectionId;
    }
    const inspectionId = primaryInspectionId;

    // B-28 — post-insert TOCTOU recheck. Runs after our insert and BEFORE
    // any side effect (confirmation email, calendar event, notifications)
    // so a losing booker only ever sees the 409, never a confirmation for
    // a booking that then vanishes. The arbitration is deterministic
    // (earliest (createdAt, id) wins), so of two racers exactly one
    // self-compensates here while the other proceeds untouched.
    const verdict = await service.arbitrateSlotRace(
        tenantId, inspectorId, body.date, requestedTime, createdRequestId,
    );
    if (verdict === 'lose') {
        await service.revokeBooking(tenantId, createdRequestId);
        throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
    }

    // Stamp the resolved address on every inspection this booking created.
    //
    // These columns existed and were populated ONLY by the dashboard wizard;
    // a public booking wrote free text and nothing else, which is why the
    // geographic half of routing had no input and "no geocode" was 100% of
    // traffic rather than an edge case. Written for both branches at once
    // rather than inside the two inserts, since the multi-service path creates
    // its rows through InspectionRequestService.
    //
    // Non-fatal, like the stamp below: the rows are committed and an
    // enrichment failure must not 500 an anonymous booker.
    if (place) {
        try {
            await db.update(inspections)
                .set({
                    addressPlaceId:    place.placeId,
                    addressStreet:     place.street,
                    addressCity:       place.city,
                    addressState:      place.state,
                    addressZip:        place.zip,
                    addressCounty:     place.county,
                    addressLat:        place.lat,
                    addressLng:        place.lng,
                    addressGeocodedAt: new Date(),
                })
                .where(and(
                    inArray(inspections.id, allInspectionIds),
                    eq(inspections.tenantId, tenantId),
                ));
        } catch (e) {
            logger.warn('booking.geocode.stamp.failed', {
                inspectionIds: allInspectionIds,
                error: e instanceof Error ? e.message : String(e),
            });
        }
    }

    // What routing actually did, on the durable record. The decision is
    // written whether or not it degraded — an audit row that appears only on
    // failure teaches nobody what normal looks like — but a substitution
    // carries the reason that explains why the workspace's chosen strategy is
    // not the one that ran. `closest` on a workspace that never geocoded its
    // address would otherwise be silently indistinguishable from working.
    if (routing) {
        c.executionCtx.waitUntil(writeAuditLogWithSlug(c.env.DB, {
            tenantId,
            action: 'booking.routing.applied',
            entityType: 'inspection',
            entityId: inspectionId,
            metadata: {
                requested: routing.requested,
                applied: routing.applied,
                reason: routing.reason,
                candidateCount: routing.candidateCount,
                inspectorId,
            },
        }));
    }

    // A-polish 9b — stamp the precise scheduled instant on every inspection
    // this booking created. The wall-clock slot time is interpreted in the
    // TENANT tz (not the naive :00Z of the startIso busy-check key), so
    // downstream conflict detection, Google push, and the ICS feed reason
    // about real instants. inspections.date is deliberately left untouched —
    // it still keys the HH:MM busy-checks via slice(11,16). Non-fatal: the
    // inspection rows already committed, so a stamp failure must not 500 the
    // booker (conflict detection just falls back to the hour-bucket).
    const tzRow = await db.select({ defaultTimezone: tenantConfigs.defaultTimezone })
        .from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();
    const tenantTz = resolveTenantTimeZone(tzRow?.defaultTimezone);
    const scheduledStartMs = wallClockToEpochMs(body.date, requestedTime, tenantTz);
    const slotWindowMin =
        body.timeSlot === 'all-day' ? 540
        : body.timeSlot === 'morning' || body.timeSlot === 'afternoon' ? 240
        : 180;
    const durationMin = bookedServiceDurationMin ?? slotWindowMin;
    const scheduledEndMs = scheduledStartMs + durationMin * 60000;
    try {
        await db.update(inspections)
            .set({
                scheduledStartMs: new Date(scheduledStartMs),
                scheduledEndMs: new Date(scheduledEndMs),
                durationMin,
            })
            .where(and(
                inArray(inspections.id, allInspectionIds),
                eq(inspections.tenantId, tenantId),
            ));
    } catch (e) {
        logger.warn('booking.scheduled-instant.stamp.failed', {
            inspectionIds: allInspectionIds,
            error: e instanceof Error ? e.message : String(e),
        });
    }

    // The deposit is resolved and FROZEN here, after the booking has survived
    // arbitration and before anyone is asked for a card. Nothing is charged in
    // this request: the amount comes back in the response, the client pays it
    // on the confirmation step, and the ledger row is written by the Stripe
    // webhook. A declined card therefore leaves a real appointment with an
    // unpaid deposit the tenant can see and chase — which is the whole point,
    // because a decline that also loses the booking is worse than no deposit
    // feature at all.
    //
    // Non-fatal, deliberately. The inspection rows are committed; a failure to
    // stamp a number must not 500 an anonymous booker.
    let depositRequiredCents = 0;
    try {
        depositRequiredCents = await resolveBookingDepositCents(
            db, tenantId, (body.services ?? []).map(s => s.serviceId),
        );
        if (depositRequiredCents > 0) {
            await snapshotOrderDeposit(db, tenantId, inspectionId, allInspectionIds, depositRequiredCents);
        }
    } catch (e) {
        logger.error('booking.deposit.snapshot.failed', { inspectionId }, e instanceof Error ? e : undefined);
    }

    const bookingClientContactId = await attachBookingPeople(c, db, tenantId, body, {
        allInspectionIds,
        directInsertInspectionId,
        resolvedAgentContactId,
        d1: deps.d1,
    });

    // Async tasks
    c.executionCtx.waitUntil(dispatchBookingConfirmation(c, db, tenantId, body, {
        inspectorId,
        requestedTime,
        inspectionId,
        bookingClientContactId,
    }));

    if (isWidgetSubmit) {
        c.executionCtx.waitUntil(
            c.var.services.widget.recordEvent(tenantId, 'success', { origin: originHeader, inspectionId })
        );
    }

    // B3 — the office alert is a rule now (`Office alert — new booking`,
    // recipientKind 'staff', channel in_app). `booking.received` is its own
    // trigger rather than a reuse of `inspection.created`: a booking is a
    // stranger arriving through the public form, while an inspection can
    // also be created by the office itself, and alerting someone about
    // their own action is noise.
    c.executionCtx.waitUntil(
        fireAutomation(c.env.DB, tenantId, inspectionId, 'booking.received'),
    );

    return c.json({
        success: true,
        data: {
            success: true,
            inspectionId,
            requestId: createdRequestId,
            inspectionIds: allInspectionIds,
            // What is OWED, not what has been collected — nothing has, at this
            // point. The confirmation step reads this to decide whether to ask
            // for a card at all; 0 means no payment step is rendered.
            depositRequiredCents,
        }
    }, 200);
}
