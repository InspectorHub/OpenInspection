import { drizzle } from 'drizzle-orm/d1';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { inspections, inspectionInspectors, tenantConfigs, users } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { resolveTenantTimeZone } from '../../lib/tz';
import {
    inspectionCivilDate,
    isoWeekKey,
    isoWeekWindow,
    isRoutingStrategy,
    pickInspectorByStrategy,
    type RoutingCandidate,
    type RoutingDecision,
    type RoutingStrategy,
} from '../../lib/booking/routing';

export interface RouteInspectorOptions {
    /** The slot's civil date (YYYY-MM-DD) — the ISO week `least_loaded` counts. */
    civilDate: string;
    /** The property's coordinates when the booking carried a resolvable address. */
    property: { lat: number; lng: number } | null;
    /** Override the tenant's configured strategy (tests, and future dispatch UI). */
    strategy?: RoutingStrategy;
}

/**
 * Read what the strategies need, then choose — and say what actually happened.
 *
 * Lives beside `booking-admission.ts` rather than inside `BookingService`
 * because it is the same kind of thing: a decision with several DB reads
 * behind it, whose value is the decision RECORD, not just the id. The service
 * keeps a three-line delegating method so `c.var.services.booking` remains the
 * single entry point callers know.
 */
export async function routeInspector(
    d1: D1Database,
    tenantId: string,
    freeIds: string[],
    opts: RouteInspectorOptions,
): Promise<RoutingDecision> {
    const db = drizzle(d1);

    const cfg = await db.select({
        strategy: tenantConfigs.bookingRoutingStrategy,
        defaultTimezone: tenantConfigs.defaultTimezone,
        companyLat: tenantConfigs.companyLat,
        companyLng: tenantConfigs.companyLng,
    }).from(tenantConfigs).where(eq(tenantConfigs.tenantId, tenantId)).get();

    const strategy: RoutingStrategy =
        opts.strategy ?? (isRoutingStrategy(cfg?.strategy) ? cfg.strategy : 'first_available');

    if (freeIds.length === 0) {
        return { inspectorId: null, requested: strategy, applied: strategy, reason: null, candidateCount: 0 };
    }

    const staff = await db.select({
        id: users.id,
        name: users.name,
        lat: users.serviceOriginLat,
        lng: users.serviceOriginLng,
    }).from(users)
        .where(and(eq(users.tenantId, tenantId), inArray(users.id, freeIds))).all();

    // The company coordinates ARE the default service origin. That inheritance
    // is what lets a single-office workspace use `closest` with no per-person
    // setup — and it is also why `closest` degrades honestly rather than
    // half-working: with no company geocode and no overrides, NOBODY is
    // anchored, which the strategy reports as `no_anchored_candidate`.
    const companyOrigin =
        typeof cfg?.companyLat === 'number' && typeof cfg?.companyLng === 'number'
            ? { lat: cfg.companyLat, lng: cfg.companyLng }
            : null;

    const weekLoads = strategy === 'least_loaded'
        ? await loadWeekCounts(db, tenantId, freeIds, opts.civilDate, resolveTenantTimeZone(cfg?.defaultTimezone))
        : new Map<string, number>();

    const candidates: RoutingCandidate[] = staff.map(s => ({
        id: s.id,
        name: s.name,
        origin: typeof s.lat === 'number' && typeof s.lng === 'number'
            ? { lat: s.lat, lng: s.lng }
            : companyOrigin,
        weekLoad: weekLoads.get(s.id) ?? 0,
    }));

    const decision = pickInspectorByStrategy({ strategy, candidates, property: opts.property });

    if (decision.reason) {
        // The substitution is an EVENT. Without this line a `closest` workspace
        // whose address never geocoded would see first_available results
        // forever and have nothing anywhere to explain why.
        logger.warn('booking.routing.substituted', {
            tenantId,
            requested: decision.requested,
            applied: decision.applied,
            reason: decision.reason,
            candidateCount: decision.candidateCount,
        });
    }
    return decision;
}

/**
 * Non-cancelled inspections per inspector in the ISO week around `civilDate`.
 *
 * Counts off `inspections.date`, NOT `scheduled_start_ms`. The latter is the
 * phase-C authoritative instant and has zero non-NULL rows in production, so
 * counting on it would make every load 0, every comparison a tie, and
 * `least_loaded` an alias for `first_available` with no error and no log.
 * The bucket is derived through the tenant zone, never off the raw string.
 */
async function loadWeekCounts(
    db: ReturnType<typeof drizzle>,
    tenantId: string,
    userIds: string[],
    civilDate: string,
    tenantTz: string,
): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const targetWeek = isoWeekKey(civilDate);
    const { fromYmd, toYmd } = isoWeekWindow(civilDate);

    const CHUNK = 80;
    for (let i = 0; i < userIds.length; i += CHUNK) {
        const rows = await db.select({
            userId: inspectionInspectors.userId,
            date: inspections.date,
        }).from(inspectionInspectors)
            .innerJoin(inspections, eq(inspections.id, inspectionInspectors.inspectionId))
            .where(and(
                eq(inspectionInspectors.tenantId, tenantId),
                inArray(inspectionInspectors.userId, userIds.slice(i, i + CHUNK)),
                sql`date(${inspections.date}) >= ${fromYmd}`,
                sql`date(${inspections.date}) <= ${toYmd}`,
                sql`${inspections.status} not in ('cancelled')`,
            )).all();
        for (const row of rows) {
            const civil = inspectionCivilDate(String(row.date), tenantTz);
            if (!civil || isoWeekKey(civil) !== targetWeek) continue;
            counts.set(row.userId, (counts.get(row.userId) ?? 0) + 1);
        }
    }
    return counts;
}
