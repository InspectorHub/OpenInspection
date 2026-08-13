import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createTestDb, setupSchema } from '../db';
import { BookingService } from '../../../server/services/booking.service';
import {
    tenants, users, availability, inspectorServiceAreas,
} from '../../../server/lib/db/schema';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
    filterEligibleInspectors,
    zipMatchesPrefix,
} from '../../../server/lib/booking/eligibility';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const MONDAY = '2026-06-08';
const areas = (entries: Array<[string, string[]]>) => new Map(entries);

describe('ZIP eligibility says when it did NOT filter', () => {
    it('an empty property ZIP is reported, not silently waved through', () => {
        // This is the defect the whole feature was built around: with no ZIP
        // on any public booking, "empty zip -> no geo filter (graceful
        // degrade)" was 100% of traffic and looked identical to a filter that
        // ran and matched everyone.
        const out = filterEligibleInspectors(['u1', 'u2'], null, areas([['u1', ['78701']]]));
        expect(out.eligibleIds).toEqual(['u1', 'u2']);
        expect(out.applied).toBe(false);
        expect(out.reason).toBe('property_zip_unknown');
    });

    it('a tenant with no declared territories is reported too', () => {
        const out = filterEligibleInspectors(['u1', 'u2'], '78701', areas([]));
        expect(out.applied).toBe(false);
        expect(out.reason).toBe('no_service_areas_configured');
    });

    it('filters when it can, and says so', () => {
        const out = filterEligibleInspectors(
            ['u1', 'u2'], '78701', areas([['u1', ['78701']], ['u2', ['73301']]]),
        );
        expect(out.eligibleIds).toEqual(['u1']);
        expect(out.applied).toBe(true);
        expect(out.reason).toBeNull();
        expect(out.excludedEveryone).toBe(false);
    });

    it('an inspector with no rows serves everywhere (mirrors service_inspectors)', () => {
        const out = filterEligibleInspectors(
            ['u1', 'u2'], '99999', areas([['u1', ['78701']]]),
        );
        expect(out.eligibleIds).toEqual(['u2']);
        expect(out.applied).toBe(true);
    });

    it('excluding everyone is a distinct, reported outcome — not an empty accident', () => {
        const out = filterEligibleInspectors(
            ['u1'], '99999', areas([['u1', ['78701']]]),
        );
        expect(out.eligibleIds).toEqual([]);
        expect(out.applied).toBe(true);
        expect(out.excludedEveryone).toBe(true);
    });

    it('prefix matching runs one way only: a 3-digit area covers a full ZIP, never the reverse', () => {
        expect(zipMatchesPrefix('78701', '787')).toBe(true);
        expect(zipMatchesPrefix('78701', '78701')).toBe(true);
        expect(zipMatchesPrefix('787', '78701')).toBe(false);
        expect(zipMatchesPrefix('78701', '')).toBe(false);
        expect(zipMatchesPrefix(' 78701 ', 'M5V')).toBe(false);
        expect(zipMatchesPrefix('m5v3a8', 'M5V')).toBe(true);
    });
});

describe('getTenantSlots applies the ZIP filter before the slot union', () => {
    let svc: BookingService;
    let db: BetterSQLite3Database<typeof schema>;
    let sqlite: any;

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db; sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(db);
        svc = new BookingService({} as any);

        await db.insert(tenants).values({ id: 't1', slug: 'acme', createdAt: new Date() });
        await db.insert(users).values([
            { id: 'u1', tenantId: 't1', email: 'u1@x.com', passwordHash: 'h', role: 'inspector', name: 'Ann', createdAt: new Date() },
            { id: 'u2', tenantId: 't1', email: 'u2@x.com', passwordHash: 'h', role: 'inspector', name: 'Bea', createdAt: new Date() },
        ]);
        await db.insert(availability).values([
            { id: 'a1', tenantId: 't1', inspectorId: 'u1', dayOfWeek: 1, startTime: '08:00', endTime: '10:00', createdAt: new Date() },
            { id: 'a2', tenantId: 't1', inspectorId: 'u2', dayOfWeek: 1, startTime: '08:00', endTime: '10:00', createdAt: new Date() },
        ]);
    });
    afterEach(() => sqlite.close());

    const area = (id: string, userId: string, zipPrefix: string) =>
        db.insert(inspectorServiceAreas).values({
            id, tenantId: 't1', userId, zipPrefix, createdAt: new Date(),
        });

    it('an in-area ZIP leaves only the serving inspector on the slot', async () => {
        await area('sa1', 'u1', '78701');
        await area('sa2', 'u2', '73301');
        const out = await svc.getTenantSlots('t1', MONDAY, [], undefined, '78701');
        expect(out.slots.find(s => s.time === '08:00')!.inspectorIds).toEqual(['u1']);
        expect(out.geoSkipped).toBeNull();
    });

    it('a ZIP nobody serves yields no slots AND says why', async () => {
        await area('sa1', 'u1', '78701');
        await area('sa2', 'u2', '73301');
        const out = await svc.getTenantSlots('t1', MONDAY, [], undefined, '99999');
        expect(out.slots).toEqual([]);
        expect(out.outsideServiceArea).toBe(true);
    });

    it('no ZIP supplied returns every slot and reports that the filter did not run', async () => {
        await area('sa1', 'u1', '78701');
        const out = await svc.getTenantSlots('t1', MONDAY, []);
        expect(out.slots.find(s => s.time === '08:00')!.inspectorIds.sort()).toEqual(['u1', 'u2']);
        expect(out.geoSkipped).toBe('property_zip_unknown');
    });

    it('another tenant`s territory rows never narrow this tenant', async () => {
        await db.insert(tenants).values({ id: 't2', slug: 'other', createdAt: new Date() });
        await db.insert(inspectorServiceAreas).values({
            id: 'sa9', tenantId: 't2', userId: 'u1', zipPrefix: '00000', createdAt: new Date(),
        });
        const out = await svc.getTenantSlots('t1', MONDAY, [], undefined, '78701');
        // t1 has no rows of its own, so the filter cannot run and says so.
        expect(out.geoSkipped).toBe('no_service_areas_configured');
        expect(out.slots.find(s => s.time === '08:00')!.inspectorIds.sort()).toEqual(['u1', 'u2']);
    });
});
