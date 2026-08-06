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

    /** The row the caller inserts right after a successful consume. The gate
     *  counts these, so a test that consumes without inserting is not modelling
     *  anything a real create path does. */
    function seedInspection(tenantId: string, i: number) {
        sqlite.prepare(
            `INSERT INTO inspections (id, tenant_id, property_address, date, created_at)
             VALUES (?, ?, '1 Main St', '2026-08-05', ?)`,
        ).run(`${tenantId}-insp-${i}`, tenantId, Date.now());
    }

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
            // The gate counts inspection ROWS, so each consume has to be paired
            // with the insert its caller performs — see inspection-quota.spec.ts
            // for the same thing through the real service.
            for (let i = 0; i < 5; i++) { await g.consumeInspection('t1'); seedInspection('t1', i); }
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

        it('a batch consume admits the whole batch or none of it', async () => {
            // Since the gate counts rows the caller has not inserted yet, a
            // caller creating N at once passes `count: N` instead of looping —
            // otherwise all N calls read the same count and all pass. See
            // consumeInspection's `count` parameter.
            await seedTenant('t4', { tier: 'free' });
            const g = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });

            await g.consumeInspection('t4', 3);
            for (let i = 0; i < 3; i++) seedInspection('t4', i);
            expect(await new MeteringService(testD1).lifetimeTotal('t4', 'inspections')).toBe(3);

            // 3 + 3 > 5 — refused outright, with nothing partially consumed.
            await expect(g.consumeInspection('t4', 3)).rejects.toMatchObject({ code: 'QUOTA_EXHAUSTED' });
            expect(await new MeteringService(testD1).lifetimeTotal('t4', 'inspections')).toBe(3);

            // 3 + 2 fits exactly.
            await expect(g.consumeInspection('t4', 2)).resolves.toBeUndefined();
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
