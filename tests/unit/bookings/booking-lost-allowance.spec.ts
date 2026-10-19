/**
 * A booking that loses the race is deleted, and the inspection allowance it
 * consumed goes back with it. Before, the rows went and the usage counter kept
 * the increment (one, or one per service for a multi-service booking), so the
 * numbers only ever drifted upward with every lost race.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import { tenants } from '../../../server/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';
import { retractLostBooking } from '../../../server/services/booking/fulfill-booking';

describe('retractLostBooking', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let testD1: D1Database;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        await setupSchema(setup.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        testD1 = toRawD1(setup.sqlite);
        await testDb.insert(tenants).values({ id: 't-pro', slug: 't-pro', tier: 'pro', createdAt: new Date() });
    });

    it('revokes the booking first, then gives back every inspection it consumed', async () => {
        const order: string[] = [];
        const service = { revokeBooking: vi.fn(async () => { order.push('revoke'); }) };
        const planQuota = { releaseInspection: vi.fn(async () => { order.push('release'); }) };
        await retractLostBooking({ planQuota: planQuota as never }, service, 't1', 'req-1', 3);
        expect(order).toEqual(['revoke', 'release']);
        expect(service.revokeBooking).toHaveBeenCalledWith('t1', 'req-1');
        expect(planQuota.releaseInspection).toHaveBeenCalledWith('t1', 3);
    });

    it('works with no quota guard (standalone)', async () => {
        const service = { revokeBooking: vi.fn(async () => undefined) };
        await expect(retractLostBooking({}, service, 't1', 'req-1', 1)).resolves.toBeUndefined();
        expect(service.revokeBooking).toHaveBeenCalledTimes(1);
    });

    it('the counter really goes back down: consume 3, release 3 leaves nothing counted (uncapped plan)', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const metering = new MeteringService(testD1);
        await guard.consumeInspection('t-pro', 3);
        expect(await metering.lifetimeTotal('t-pro', 'inspections')).toBe(3);
        await guard.releaseInspection('t-pro', 3);
        expect(await metering.lifetimeTotal('t-pro', 'inspections')).toBe(0);
    });

    it('releasing one by default still takes back exactly one (control for the old behaviour)', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const metering = new MeteringService(testD1);
        await guard.consumeInspection('t-pro', 2);
        await guard.releaseInspection('t-pro');
        expect(await metering.lifetimeTotal('t-pro', 'inspections')).toBe(1);
    });
});
