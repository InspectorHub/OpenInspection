/**
 * Commercial PCA Phase U (Batch C2a) — per-unit progress summary.
 *
 * Exercises the GET /api/inspections/:id/unit-progress computation against a
 * real better-sqlite3 db: seed an inspection with a template snapshot, create
 * units via UnitService, write an inspection_results row with some rated
 * findings across two units + the common scope, then read them back through the
 * SAME tenant-scoped drizzle queries the handler uses and apply the SAME
 * `computeUnitProgress(...)` the handler applies (see the unitProgressRoute
 * handler in server/api/inspections/hierarchy.ts). Asserts per-unit rated/total
 * and the common-scope count.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { computeUnitProgress } from '../../../server/lib/unit-progress';
import { UnitService } from '../../../server/services/unit.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { inspectionResults } from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';
const RESULTS = '22222222-2222-2222-2222-222222222222';

// A three-item template — `total` is the item count (3) for every scope.
const TEMPLATE = {
    sections: [{ id: 's1', items: [{ id: 'i1' }, { id: 'i2' }, { id: 'i3' }] }],
};

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT,
        propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
        templateSnapshot: TEMPLATE,
        unitInspectionMode: 'per_unit',
    });
}

describe('unit-progress summary (Phase U Batch C2a)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let unitSvc: UnitService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        unitSvc = new UnitService({} as D1Database);
        await seed(testDb);
    });

    it('counts rated findings per unit + the common scope against the template total', async () => {
        const u1 = await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '101' });
        const u2 = await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '102' });

        // u1: i1 + i2 rated, i3 unrated. u2: i1 rated only. common: i1 + i2 rated.
        const data: Record<string, unknown> = {
            [`${u1.id}:s1:i1`]: { rating: 'good' },
            [`${u1.id}:s1:i2`]: { rating: 'poor' },
            [`${u1.id}:s1:i3`]: { rating: null },
            [`${u2.id}:s1:i1`]: { rating: 'fair' },
            '_default:s1:i1': { rating: 'good' },
            '_default:s1:i2': { rating: 'good' },
        };
        await testDb.insert(inspectionResults).values({
            id: RESULTS, tenantId: TENANT, inspectionId: INSPECTION,
            data, lastSyncedAt: new Date(),
        });

        // Mirror the handler's reads exactly.
        const units = (await unitSvc.list(TENANT, INSPECTION)).filter((u) => u.kind === 'unit');
        const row = await testDb.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, INSPECTION), eq(inspectionResults.tenantId, TENANT)))
            .get();
        const summary = computeUnitProgress(
            (row?.data || {}) as Record<string, unknown>,
            TEMPLATE,
            units.map((u) => u.id),
        );

        expect(summary.total).toBe(3);
        expect(summary.commonRated).toBe(2);
        const p1 = summary.units.find((u) => u.unitId === u1.id)!;
        const p2 = summary.units.find((u) => u.unitId === u2.id)!;
        expect(p1).toEqual({ unitId: u1.id, rated: 2, total: 3 });
        expect(p2).toEqual({ unitId: u2.id, rated: 1, total: 3 });
    });

    it('is tenant-scoped: another tenant\'s units + results never enter this summary', async () => {
        const OTHER = '00000000-0000-0000-0000-0000000000ff';
        await testDb.insert(schema.tenants).values({
            id: OTHER, name: 'Other', slug: 'other', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        // Same inspection id space is unique per row, so give the other tenant its
        // own inspection + units + results — the handler filters by tenantId, so
        // tenant A's list()/results query must exclude ALL of it.
        const OTHER_INSP = '11111111-1111-1111-1111-1111111111ff';
        await testDb.insert(schema.inspections).values({
            id: OTHER_INSP, tenantId: OTHER, propertyAddress: 'x', date: '2026-06-01',
            status: 'requested', paymentStatus: 'unpaid', price: 0, paymentRequired: false,
            agreementRequired: false, createdAt: new Date(), templateSnapshot: TEMPLATE,
            unitInspectionMode: 'per_unit',
        });
        const ghost = await unitSvc.create(OTHER, { inspectionId: OTHER_INSP, parentUnitId: null, kind: 'unit', name: 'GHOST' });
        await testDb.insert(inspectionResults).values({
            id: '33333333-3333-3333-3333-3333333333ff', tenantId: OTHER, inspectionId: OTHER_INSP,
            data: { [`${ghost.id}:s1:i1`]: { rating: 'good' }, '_default:s1:i1': { rating: 'good' } },
            lastSyncedAt: new Date(),
        });

        // Tenant A's inspection has one unit + one rated common finding.
        const u1 = await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '101' });
        await testDb.insert(inspectionResults).values({
            id: RESULTS, tenantId: TENANT, inspectionId: INSPECTION,
            data: { '_default:s1:i1': { rating: 'good' } }, lastSyncedAt: new Date(),
        });

        // Mirror the handler's tenant-scoped reads for TENANT.
        const units = (await unitSvc.list(TENANT, INSPECTION)).filter((u) => u.kind === 'unit');
        const row = await testDb.select().from(inspectionResults)
            .where(and(eq(inspectionResults.inspectionId, INSPECTION), eq(inspectionResults.tenantId, TENANT)))
            .get();
        const summary = computeUnitProgress((row?.data || {}) as Record<string, unknown>, TEMPLATE, units.map((u) => u.id));

        // Only tenant A's single unit is present; GHOST is absent; common count is A's only.
        expect(summary.units).toEqual([{ unitId: u1.id, rated: 0, total: 3 }]);
        expect(summary.units.some((u) => u.unitId === ghost.id)).toBe(false);
        expect(summary.commonRated).toBe(1);
    });

    it('reports zero rated for a unit with no findings and an empty results row', async () => {
        const u1 = await unitSvc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'unit', name: '101' });
        await testDb.insert(inspectionResults).values({
            id: RESULTS, tenantId: TENANT, inspectionId: INSPECTION,
            data: {}, lastSyncedAt: new Date(),
        });

        const units = (await unitSvc.list(TENANT, INSPECTION)).filter((u) => u.kind === 'unit');
        const summary = computeUnitProgress({}, TEMPLATE, units.map((u) => u.id));

        expect(summary.total).toBe(3);
        expect(summary.commonRated).toBe(0);
        expect(summary.units).toEqual([{ unitId: u1.id, rated: 0, total: 3 }]);
    });
});
