import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants, tenantConfigs, users, inspections, inspectionInspectors,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    pickInspectorByStrategy,
    inspectionCivilDate,
    isoWeekKey,
    haversineKm,
    type RoutingCandidate,
} from '../../../server/lib/booking/routing';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

/**
 * THE POINT OF THIS FILE.
 *
 * Every strategy here has an input on which it returns a perfectly plausible
 * inspector id while having computed nothing at all — `least_loaded` when no
 * candidate has dated work, `closest` when nothing is geocoded. Those are not
 * corner cases: they were the ONLY case in production, because
 * `scheduled_start_ms` has no non-NULL rows and no public booking carried a
 * geocode. A test that asserted "least_loaded returns somebody" would have
 * passed against an empty database and proved nothing.
 *
 * So every degenerate assertion below is on the REPORTED reason, not on the
 * returned id.
 */

const cand = (
    id: string,
    over: Partial<RoutingCandidate> = {},
): RoutingCandidate => ({ id, name: id, origin: null, weekLoad: 0, ...over });

const AUSTIN = { lat: 30.2672, lng: -97.7431 };
const DALLAS = { lat: 32.7767, lng: -96.797 };
const HOUSTON = { lat: 29.7604, lng: -95.3698 };

describe('routing strategies report the case they cannot compute', () => {
    it('first_available sorts by (name, id) and never reports a substitution', () => {
        const d = pickInspectorByStrategy({
            strategy: 'first_available',
            candidates: [cand('u3', { name: 'Carl' }), cand('u1', { name: 'Ann' }), cand('u2', { name: 'Bea' })],
            property: null,
        });
        expect(d.inspectorId).toBe('u1');
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBeNull();
    });

    // ── least_loaded ────────────────────────────────────────────────────────
    it('least_loaded picks the lighter week when loads differ', () => {
        const d = pickInspectorByStrategy({
            strategy: 'least_loaded',
            candidates: [cand('u1', { name: 'Ann', weekLoad: 4 }), cand('u2', { name: 'Bea', weekLoad: 1 })],
            property: null,
        });
        expect(d.inspectorId).toBe('u2');
        expect(d.applied).toBe('least_loaded');
        expect(d.reason).toBeNull();
    });

    it('least_loaded REPORTS no_dated_work when every load is zero, instead of tying into first_available', () => {
        const d = pickInspectorByStrategy({
            strategy: 'least_loaded',
            candidates: [cand('u1', { name: 'Ann' }), cand('u2', { name: 'Bea' })],
            property: null,
        });
        // It still returns somebody — that is the whole danger. The signal is
        // the reason, and the honest statement of which strategy ran.
        expect(d.inspectorId).toBe('u1');
        expect(d.requested).toBe('least_loaded');
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('no_dated_work');
    });

    // ── closest ─────────────────────────────────────────────────────────────
    it('closest picks the nearest anchored candidate', () => {
        const d = pickInspectorByStrategy({
            strategy: 'closest',
            candidates: [
                cand('u1', { name: 'Ann', origin: DALLAS }),
                cand('u2', { name: 'Bea', origin: HOUSTON }),
            ],
            property: AUSTIN,
        });
        expect(haversineKm(AUSTIN, HOUSTON)).toBeLessThan(haversineKm(AUSTIN, DALLAS));
        expect(d.inspectorId).toBe('u2');
        expect(d.applied).toBe('closest');
        expect(d.reason).toBeNull();
    });

    it('closest REPORTS property_ungeocoded rather than ranking an unknown property last', () => {
        const d = pickInspectorByStrategy({
            strategy: 'closest',
            candidates: [cand('u1', { name: 'Ann', origin: DALLAS }), cand('u2', { name: 'Bea', origin: HOUSTON })],
            property: null,
        });
        expect(d.requested).toBe('closest');
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('property_ungeocoded');
    });

    it('closest REPORTS no_anchored_candidate when fewer than two candidates have an origin', () => {
        const d = pickInspectorByStrategy({
            strategy: 'closest',
            candidates: [cand('u1', { name: 'Ann', origin: DALLAS }), cand('u2', { name: 'Bea' })],
            property: AUSTIN,
        });
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('no_anchored_candidate');
    });

    it('a candidate with no origin is NOT ranked last — it is not an input at all', () => {
        // u3 is unanchored and sits far from everyone. With three candidates
        // the strategy still runs, and u3 must be absent from the ranking
        // rather than sorted to the bottom (a sort position is a claim about
        // a distance nobody measured).
        const d = pickInspectorByStrategy({
            strategy: 'closest',
            candidates: [
                cand('u1', { name: 'Ann', origin: DALLAS }),
                cand('u2', { name: 'Bea', origin: HOUSTON }),
                cand('u3', { name: 'Aaa' }),
            ],
            property: AUSTIN,
        });
        expect(d.inspectorId).toBe('u2');
        expect(d.reason).toBeNull();
    });

    it('a single candidate reports single_candidate: no strategy chose anything', () => {
        for (const strategy of ['least_loaded', 'closest'] as const) {
            const d = pickInspectorByStrategy({
                strategy,
                candidates: [cand('u1', { name: 'Ann', origin: DALLAS, weekLoad: 3 })],
                property: AUSTIN,
            });
            expect(d.inspectorId).toBe('u1');
            expect(d.applied).toBe('first_available');
            expect(d.reason).toBe('single_candidate');
        }
    });

    it('no candidates yields a null id and no invented reason', () => {
        const d = pickInspectorByStrategy({ strategy: 'closest', candidates: [], property: AUSTIN });
        expect(d.inspectorId).toBeNull();
        expect(d.reason).toBeNull();
        expect(d.candidateCount).toBe(0);
    });
});

describe('ISO-week bucketing reads inspections.date through the tenant zone', () => {
    it('a bare civil date is taken as written, never reinterpreted as UTC midnight', () => {
        // Parsing '2026-06-08' as an instant and rendering it in Chicago would
        // yield 2026-06-07 — the calendar off-by-one this repo has a lint gate
        // for. A civil date has no zone to convert from.
        expect(inspectionCivilDate('2026-06-08', 'America/Chicago')).toBe('2026-06-08');
    });

    it('a stored instant IS converted, so late-evening UTC lands on the office day', () => {
        // 2026-06-09T02:00Z is still the 8th in Chicago (UTC-5 in June).
        expect(inspectionCivilDate('2026-06-09T02:00:00Z', 'America/Chicago')).toBe('2026-06-08');
        expect(inspectionCivilDate('2026-06-09T02:00:00Z', 'UTC')).toBe('2026-06-09');
    });

    it('unparseable stored values are dropped, not counted as today', () => {
        expect(inspectionCivilDate('not-a-date', 'UTC')).toBeNull();
    });

    it('ISO weeks run Monday to Sunday and belong to their Thursday year', () => {
        expect(isoWeekKey('2026-06-08')).toBe(isoWeekKey('2026-06-14')); // Mon..Sun
        expect(isoWeekKey('2026-06-08')).not.toBe(isoWeekKey('2026-06-15'));
        // 2027-01-01 is a Friday, so it belongs to ISO week 53 of 2026.
        expect(isoWeekKey('2027-01-01')).toBe('2026-W53');
    });
});

// 2026-06-08 is a Monday.
const MONDAY = '2026-06-08';

describe('routeInspector against real rows', () => {
    let svc: BookingService;
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    const setStrategy = async (strategy: string, extra: Record<string, unknown> = {}) => {
        await db.delete(tenantConfigs);
        await db.insert(tenantConfigs).values({
            tenantId: 't1',
            bookingRoutingStrategy: strategy as 'first_available',
            defaultTimezone: 'America/Chicago',
            updatedAt: new Date(),
            ...extra,
        });
    };

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as any);

        await db.insert(tenants).values({ id: 't1', name: 'Acme', slug: 'acme', createdAt: new Date() });
        await db.insert(users).values([
            { id: 'u1', tenantId: 't1', email: 'u1@x.com', passwordHash: 'h', role: 'inspector', name: 'Ann', createdAt: new Date() },
            { id: 'u2', tenantId: 't1', email: 'u2@x.com', passwordHash: 'h', role: 'inspector', name: 'Bea', createdAt: new Date() },
        ]);
    });
    afterEach(() => sqlite.close());

    /** Give `who` a dated, non-cancelled inspection inside MONDAY's ISO week. */
    const giveWork = async (id: string, who: string, date: string) => {
        await db.insert(inspections).values({
            id, tenantId: 't1', inspectorId: who, propertyAddress: '1 Main St',
            date, status: 'scheduled', createdAt: new Date(),
        });
        await db.insert(inspectionInspectors).values({
            inspectionId: id, userId: who, tenantId: 't1', role: 'lead', createdAt: new Date(),
        });
    };

    it('least_loaded counts inspections.date — NOT scheduled_start_ms, which is empty', async () => {
        await setStrategy('least_loaded');
        // Both rows leave scheduled_start_ms NULL, exactly as every production
        // row does. Counting on that column would make both loads 0 and this
        // assertion would read `no_dated_work`.
        await giveWork('i1', 'u1', `${MONDAY}T09:00:00Z`);
        await giveWork('i2', 'u1', '2026-06-10');

        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: null });
        expect(d.applied).toBe('least_loaded');
        expect(d.reason).toBeNull();
        expect(d.inspectorId).toBe('u2');
    });

    it('least_loaded on a workspace with no dated work reports no_dated_work', async () => {
        await setStrategy('least_loaded');
        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: null });
        expect(d.requested).toBe('least_loaded');
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('no_dated_work');
    });

    it('work in an ADJACENT week is not this week`s load', async () => {
        await setStrategy('least_loaded');
        await giveWork('i1', 'u1', '2026-06-15'); // the following Monday
        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: null });
        expect(d.reason).toBe('no_dated_work');
    });

    it('closest inherits the COMPANY coordinates as each inspector default origin', async () => {
        await setStrategy('closest', { companyLat: DALLAS.lat, companyLng: DALLAS.lng });
        // u2 works out of Houston; u1 inherits the Dallas office.
        await db.update(users).set({ serviceOriginLat: HOUSTON.lat, serviceOriginLng: HOUSTON.lng })
            .where(eq(users.id, 'u2'));

        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: AUSTIN });
        expect(d.applied).toBe('closest');
        expect(d.reason).toBeNull();
        expect(d.inspectorId).toBe('u2');
    });

    it('closest with no company geocode and no overrides reports no_anchored_candidate', async () => {
        await setStrategy('closest');
        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: AUSTIN });
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('no_anchored_candidate');
    });

    it('closest on an ungeocoded property reports property_ungeocoded', async () => {
        await setStrategy('closest', { companyLat: DALLAS.lat, companyLng: DALLAS.lng });
        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: null });
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBe('property_ungeocoded');
    });

    it('a tenant with no config row routes first_available without reporting a substitution', async () => {
        const d = await svc.routeInspector('t1', ['u1', 'u2'], { civilDate: MONDAY, property: null });
        expect(d.requested).toBe('first_available');
        expect(d.applied).toBe('first_available');
        expect(d.reason).toBeNull();
        expect(d.inspectorId).toBe('u1');
    });
});
