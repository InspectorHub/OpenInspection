/**
 * Task 3 (free-tier usage quotas) — inspection creation consumes the
 * `PlanQuotaGuard` free-tier counter. Covers all three create paths
 * (createInspection / cloneInspection / createReinspection) sharing one
 * lifetime counter, that deletes never refund it, and that a deploy with
 * no guard injected (standalone) stays unlimited.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { createTestDb, setupSchema, toRawD1 } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

// Mock drizzle-orm/d1 so every `drizzle(d1)` call inside InspectionService /
// PlanQuotaGuard / MeteringService returns the same in-memory SQLite-backed
// Drizzle instance (matches the pattern in inspection-create-policy.spec.ts
// and plan-quota.spec.ts). PlanQuotaGuard's raw `db.prepare(...).bind(...).run()`
// path bypasses this mock — it runs against `testD1` (the toRawD1 adapter).
vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

import { InspectionService } from '../../server/services/inspection.service';
import { PlanQuotaGuard } from '../../server/features/plan-quota/guard';
import { MeteringService } from '../../server/services/metering.service';
import { ScopedDB } from '../../server/lib/db/scoped';
import { deleteInspectionCascade } from '../../server/services/inspection/inspection-cascade';

const TENANT = 't1';

function minimalCreateData() {
    return {
        propertyAddress: '1 Main St',
        clientName: 'Test Client',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

function makeR2(): R2Bucket {
    return {
        list: async () => ({ objects: [], truncated: false, cursor: undefined }),
        delete: async () => { /* no-op — no objects were ever seeded */ },
    } as unknown as R2Bucket;
}

describe('Inspection creation consumes the free-tier quota (Task 3)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let testD1: D1Database;
    let sdb: ScopedDB;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        testD1 = toRawD1(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        sdb = new ScopedDB(testDb as any, TENANT);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    function makeService(planQuota?: PlanQuotaGuard) {
        return new InspectionService({} as D1Database, undefined, sdb, undefined, undefined, planQuota);
    }

    it('blocks the 6th create for a free tenant with 402/QUOTA_EXHAUSTED', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = makeService(guard);

        for (let i = 0; i < 5; i++) await svc.createInspection(TENANT, minimalCreateData());
        await expect(svc.createInspection(TENANT, minimalCreateData())).rejects.toMatchObject({
            status: 402,
            code: 'QUOTA_EXHAUSTED',
        });
        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(5);
    });

    it('clone and re-inspection consume the same counter', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = makeService(guard);

        const a = await svc.createInspection(TENANT, minimalCreateData()); // 1
        await svc.cloneInspection(a.id, TENANT); // 2

        // createReinspection gates on a PUBLISHED baseline (>=1 report_versions
        // row) — seed one directly, mirroring reinspection-create.spec.ts.
        await testDb.insert(schema.reportVersions).values({
            id: crypto.randomUUID(), tenantId: TENANT, inspectionId: a.id,
            versionNumber: 1,
            snapshotJson: JSON.stringify({ inspection: { id: a.id }, data: {}, units: [] }),
            publishedAt: Math.floor(Date.now() / 1000), publishedBy: 'user-a',
            createdAt: new Date().toISOString(),
        });
        await svc.createReinspection(TENANT, a.id, { selectedItemIds: [] }); // 3

        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(3);
    });

    it('a delete does not refund quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = makeService(guard);

        const a = await svc.createInspection(TENANT, minimalCreateData());
        await deleteInspectionCascade(testDb as unknown as DrizzleD1Database, makeR2(), TENANT, a.id);

        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(1);
    });

    it('cloneInspection of a nonexistent id rejects and does not consume quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = makeService(guard);

        await svc.createInspection(TENANT, minimalCreateData()); // 1 — establishes a nonzero baseline
        await expect(svc.cloneInspection('does-not-exist', TENANT)).rejects.toMatchObject({
            status: 404,
        });

        // The failed lookup must not have burned a lifetime slot.
        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(1);
    });

    it('createReinspection with a nonexistent baseline rejects and does not consume quota', async () => {
        const guard = new PlanQuotaGuard(testD1, { enforced: true, billingPortalUrl: null });
        const svc = makeService(guard);

        await svc.createInspection(TENANT, minimalCreateData()); // 1 — establishes a nonzero baseline
        await expect(svc.createReinspection(TENANT, 'does-not-exist', { selectedItemIds: [] }))
            .rejects.toThrow(/baseline inspection not found/i);

        // The failed lookup must not have burned a lifetime slot.
        expect(await new MeteringService(testD1).lifetimeTotal(TENANT, 'inspections')).toBe(1);
    });

    it('without a guard (standalone DI), creates are unlimited', async () => {
        const bare = makeService(undefined);

        for (let i = 0; i < 6; i++) await bare.createInspection(TENANT, minimalCreateData());

        // 6 rows exist even though the free-tier cap is 5 — no guard injected
        // means no cap is enforced, matching standalone DI (hasUsageQuota=false).
        const rows = await testDb.select().from(schema.inspections).all();
        expect(rows.length).toBe(6);
    });
});
