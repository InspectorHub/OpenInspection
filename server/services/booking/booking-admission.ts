import type { Context } from 'hono';
import { eq, and } from 'drizzle-orm';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { users } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { resolvePublicHolidayEffect } from '../../lib/holidays/load-tenant-holidays';
import type { HonoConfig } from '../../types/hono';
import type { PublicBookingSchema } from '../../lib/validations/booking.schema';
import type { z } from '@hono/zod-openapi';
import { fetchPlaceDetails, placeDetailsCacheKey, type ResolvedPlace } from '../../lib/places/geocode';
import type { RoutingDecision } from '../../lib/booking/routing';

/** What survives admission: a slot claimed for a named, tenant-owned inspector. */
export interface BookingClaim {
    inspectorId: string;
    requestedTime: string;
    /** Carried through for the widget success/error telemetry the caller emits. */
    isWidgetSubmit: boolean;
    originHeader: string | undefined;
    /**
     * The property's resolved location, or null when the booking carried no
     * placeId / the lookup failed. Written onto the inspection row by the
     * caller and fed to `closest` routing here.
     */
    place: ResolvedPlace | null;
    /**
     * How the inspector was chosen — including a substitution and its reason.
     * Null only when the client named an inspector, in which case no strategy
     * ran and there is nothing to report.
     */
    routing: RoutingDecision | null;
}

/**
 * Resolve the selected address to coordinates. Fail-soft by contract: a
 * booking whose geocode fails is still a booking, and the consequence (no
 * `closest` routing for it) is reported by the routing decision rather than
 * guessed at.
 */
async function resolveProperty(
    c: Context<HonoConfig>,
    placeId: string | undefined,
): Promise<ResolvedPlace | null> {
    if (!placeId) return null;
    const apiKey = c.env.GOOGLE_PLACES_API_KEY;
    if (!apiKey) return null;
    const cacheKey = placeDetailsCacheKey(placeId);
    if (c.env.TENANT_CACHE) {
        const cached = await c.env.TENANT_CACHE.get(cacheKey, 'json') as ResolvedPlace | null;
        if (cached) return cached;
    }
    const resolved = await fetchPlaceDetails(apiKey, placeId);
    if (resolved && c.env.TENANT_CACHE) {
        await c.env.TENANT_CACHE.put(cacheKey, JSON.stringify(resolved), { expirationTtl: 60 * 24 * 60 * 60 });
    }
    return resolved;
}

/**
 * Everything that must hold BEFORE a booking writes a row, in the order it must
 * hold, ending with a claimed slot.
 *
 * The seam is the absence of writes. Every check here can reject an anonymous
 * stranger's form post with a 403/404/409 and leave the database exactly as it
 * was; the moment one row exists the failure modes change completely (a losing
 * booker has to be compensated, not refused — see `arbitrateSlotRace`). Keeping
 * the refusals together is what makes it checkable that quota is consumed after
 * all of them, which is the property `plan-quota-guarded-services.spec.ts` and
 * the comment in `fulfillBooking`'s direct-insert branch both depend on.
 *
 * The two D1 handles are NOT interchangeable and both are parameters on
 * purpose: `db` is drizzle over `c.env.DB` (the request's), `d1` is the
 * BookingService instance's own. The original code used each where it is used
 * here, and unit tests construct the service with a handle that is not
 * `c.env.DB`.
 */
export async function admitBooking(
    c: Context<HonoConfig>,
    db: DrizzleD1Database,
    d1: D1Database,
    tenantId: string,
    body: z.infer<typeof PublicBookingSchema>,
): Promise<BookingClaim> {
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

    const holiday = await resolvePublicHolidayEffect(d1, tenantId, body.date);
    if (holiday.effect === 'block') {
        throw Errors.BadRequest(
            holiday.name
                ? `The office is closed on ${holiday.name}. Please pick another date.`
                : 'The office is closed on this date. Please pick another date.',
            'HOLIDAY_BLOCKED',
        );
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
    // The property's own location, resolved once: the ZIP narrows who is even
    // offered a slot, and the coordinates are what `closest` measures to.
    const place = await resolveProperty(c, body.addressPlaceId);
    const propertyZip = place?.zip ?? body.addressZip ?? null;

    const { slots, outsideServiceArea } = await service.getTenantSlots(
        tenantId, body.date, serviceIdsForQual, qualifiedIds, propertyZip,
    );
    if (outsideServiceArea) {
        throw Errors.Conflict('No inspector currently serves that area. Please contact the company directly to schedule.');
    }
    const target = slots.find(s => s.time === requestedTime);
    const freeIds = (target?.inspectorIds ?? []).filter(id => !inspectorId || id === inspectorId);
    if (freeIds.length === 0) {
        throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
    }
    let routing: RoutingDecision | null = null;
    if (!inspectorId) {
        routing = await service.routeInspector(tenantId, freeIds, {
            civilDate: body.date,
            property: place ? { lat: place.lat, lng: place.lng } : null,
        });
        inspectorId = routing.inspectorId;
        if (!inspectorId) throw Errors.Conflict('That time slot is no longer available. Please pick another time.');
    }

    return { inspectorId, requestedTime, isWidgetSubmit, originHeader, place, routing };
}
