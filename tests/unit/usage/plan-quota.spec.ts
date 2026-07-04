import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createTestDb, setupSchema, toRawD1 } from '../db';
import { tenants } from '../../../server/lib/db/schema';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';

// Mock the drizzle-orm/d1 module so the guard's `drizzle(d1)` call (used for
// the tenants.tier lookup and for MeteringService) returns our in-memory
// SQLite-backed Drizzle instance instead of a real D1 client. The guard's
// raw `db.prepare(...).bind(...).run()` path bypasses this mock entirely —
// it runs against `testD1`, a thin D1Database-shaped adapter over the same
// underlying sqlite (see toRawD1 in ./db).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { PlanQuotaGuard } from '../../../server/features/plan-quota/guard';
import { MeteringService } from '../../../server/services/metering.service';

describe('PlanQuotaGuard', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let testD1: D1Database;

    beforeEach(async () => {
        const setup = createTestDb();
        testDb = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        (mockDrizzle as any).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);
    });

    async function seedTenant(id: string, opts: { tier: 'free' | 'pro' | 'enterprise' }) {
        await testDb.insert(tenants).values({
            id,
            name: `Tenant ${id}`,
            slug: id,
            tier: opts.tier,
            createdAt: new Date(),
        });
    }

    describe('consumeInspection', () => {
        it('allows and counts the first 5 creates for a free tenant, blocks the 6th', async () => {
            await seedTenant('t1', { tier: 'free' });
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: 'https://x/billing' });
            for (let i = 0; i < 5; i++) await g.consumeInspection('t1');
            await expect(g.consumeInspection('t1')).rejects.toMatchObject({
                status: 402,
                code: 'QUOTA_EXHAUSTED',
                details: { metric: 'inspections', used: 5, cap: 5, billingPortalUrl: 'https://x/billing' },
            });
            expect(await new MeteringService(testD1).lifetimeTotal('t1', 'inspections')).toBe(5);
        });

        it('pro tenants increment without a cap', async () => {
            await seedTenant('t2', { tier: 'pro' });
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
            for (let i = 0; i < 7; i++) await g.consumeInspection('t2');
            expect(await new MeteringService(testD1).lifetimeTotal('t2', 'inspections')).toBe(7);
        });

        it('enforced=false (standalone) increments without a cap even for tier=free', async () => {
            await seedTenant('t3', { tier: 'free' });
            const g = new PlanQuotaGuard(testD1, { enforced: false, billingPortalUrl: null });
            for (let i = 0; i < 6; i++) await g.consumeInspection('t3');
            expect(await new MeteringService(testD1).lifetimeTotal('t3', 'inspections')).toBe(6);
        });

        it('is race-safe: the conditional increment never exceeds the cap', async () => {
            await seedTenant('t4', { tier: 'free' });
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
            const results = await Promise.allSettled(Array.from({ length: 8 }, () => g.consumeInspection('t4')));
            expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(5);
            expect(await new MeteringService(testD1).lifetimeTotal('t4', 'inspections')).toBe(5);
        });
    });

    describe('checkMessagingQuota', () => {
        it('throws for a free tenant at 50 lifetime platform sms', async () => {
            const m = new MeteringService(testD1);
            await m.record('t5', 'sms', '2026-06', 50);
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
            await expect(g.checkMessagingQuota('t5', 'free', 'sms')).rejects.toMatchObject({ status: 402, code: 'QUOTA_EXHAUSTED' });
        });

        it('byo volume does not count', async () => {
            const m = new MeteringService(testD1);
            await m.record('t6', 'sms_byo', '2026-06', 500);
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
            await expect(g.checkMessagingQuota('t6', 'free', 'sms')).resolves.toBeUndefined();
        });

        it('no-op for pro tier and for enforced=false', async () => {
            const m = new MeteringService(testD1);
            await m.record('t7', 'email', '2026-06', 500);
            await expect(new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null })
                .checkMessagingQuota('t7', 'pro', 'email')).resolves.toBeUndefined();
            await expect(new PlanQuotaGuard(testD1, { enforced: false, billingPortalUrl: null })
                .checkMessagingQuota('t7', 'free', 'email')).resolves.toBeUndefined();
        });
    });
});
