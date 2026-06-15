/**
 * Design System 0520 subsystem D phase 1 task 1.2 — UnitService tests.
 *
 * Covers create + list + delete (cascade) + move + tree-depth +
 * sibling-name uniqueness + cycle detection.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnitService } from '../../server/services/unit.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION = '11111111-1111-1111-1111-111111111111';

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
    });
}

describe('UnitService (subsystem D P1 T1.2)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: UnitService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new UnitService({} as D1Database);
    });

    it('creates a root building', async () => {
        const out = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'Building A' });
        expect(out.id).toBeTruthy();
        const list = await svc.list(TENANT, INSPECTION);
        expect(list).toHaveLength(1);
        expect(list[0]!.name).toBe('Building A');
    });

    it('rejects depth > 3 (root → building → floor → unit)', async () => {
        const b = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B' });
        const f = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b.id, kind: 'floor', name: 'F' });
        const u = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: f.id, kind: 'unit', name: 'U' });
        await expect(svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: u.id, kind: 'unit', name: 'Sub' }))
            .rejects.toThrow(/depth/i);
    });

    it('rejects duplicate sibling name under same parent', async () => {
        await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'A' });
        await expect(svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'A' }))
            .rejects.toThrow(/duplicate/i);
    });

    it('allows same sibling name under different parents', async () => {
        const b1 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B1' });
        const b2 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B2' });
        await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b1.id, kind: 'floor', name: 'Floor 1' });
        // Same name under different parent is fine
        const f2 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b2.id, kind: 'floor', name: 'Floor 1' });
        expect(f2.id).toBeTruthy();
    });

    it('delete cascades children', async () => {
        const b = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B' });
        await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b.id, kind: 'floor', name: 'F1' });
        await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b.id, kind: 'floor', name: 'F2' });
        await svc.delete(TENANT, b.id);
        const list = await svc.list(TENANT, INSPECTION);
        expect(list).toHaveLength(0);
    });

    it('move reparents + renumbers sort_order', async () => {
        const b1 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B1' });
        const b2 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B2' });
        const f1 = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b1.id, kind: 'floor', name: 'F1' });
        await svc.move(TENANT, f1.id, b2.id, 0);
        const list = await svc.list(TENANT, INSPECTION);
        const moved = list.find(u => u.id === f1.id)!;
        expect(moved.parentUnitId).toBe(b2.id);
        expect(moved.sortOrder).toBe(0);
    });

    it('move detects cycle (cannot make a node its own descendant)', async () => {
        const b = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'B' });
        const f = await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: b.id, kind: 'floor', name: 'F' });
        // Try to make B a child of F (its own descendant)
        await expect(svc.move(TENANT, b.id, f.id, 0)).rejects.toThrow(/cycle/i);
    });

    it('tenant scoping — cannot see another tenant\'s units', async () => {
        await svc.create(TENANT, { inspectionId: INSPECTION, parentUnitId: null, kind: 'building', name: 'A' });
        const list = await svc.list('other-tenant', INSPECTION);
        expect(list).toEqual([]);
    });
});
