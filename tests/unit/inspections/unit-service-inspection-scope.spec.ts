/**
 * UnitService.update / delete / move resolve the unit by company AND inspection; a parent named on create,
 * bulk create or move must belong to the same inspection. A mismatch is "not found", never a partial write.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UnitService } from '../../../server/services/unit.service';
import { createTestDb, setupSchema } from '../db';
import { asD1DrizzleReturn } from '../helpers/test-db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = 't-one';
const OTHER = 't-two';
const INSP_A = 'insp-a';
const INSP_B = 'insp-b';

describe('UnitService inspection scoping', () => {
    let db: BetterSQLite3Database<typeof schema>;
    let svc: UnitService;
    let a: { id: string };
    let aChild: { id: string };
    let b: { id: string };
    let bChild: { id: string };
    let foreign: { id: string };

    beforeEach(async () => {
        const fix = createTestDb();
        db = fix.db;
        await setupSchema(fix.sqlite);
        vi.mocked(mockDrizzle).mockReturnValue(asD1DrizzleReturn(db));
        const now = new Date();
        await db.insert(schema.tenants).values([TENANT, OTHER].map((id) => ({
            id, slug: id, status: 'active' as const, deploymentMode: 'shared' as const, tier: 'free' as const, createdAt: now,
        })));
        const insp = (id: string, tenantId: string) => ({
            id, tenantId, propertyAddress: id, date: '2026-06-01', status: 'requested' as const, paymentStatus: 'unpaid' as const,
            price: 0, paymentRequired: false, agreementRequired: false, createdAt: now,
        });
        await db.insert(schema.inspections).values([insp(INSP_A, TENANT), insp(INSP_B, TENANT), insp('insp-x', OTHER)]);
        svc = new UnitService({} as D1Database);
        a = await svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: null, kind: 'building', name: 'A' });
        aChild = await svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: a.id, kind: 'floor', name: 'A1' });
        b = await svc.create(TENANT, { inspectionId: INSP_B, parentUnitId: null, kind: 'building', name: 'B' });
        bChild = await svc.create(TENANT, { inspectionId: INSP_B, parentUnitId: b.id, kind: 'floor', name: 'B1' });
        foreign = await svc.create(OTHER, { inspectionId: 'insp-x', parentUnitId: null, kind: 'building', name: 'X' });
    });

    const rows = () => db.select().from(schema.inspectionUnits).orderBy(schema.inspectionUnits.id).all();

    it('update: a unit of another inspection or company is not found and unchanged', async () => {
        const before = await rows();
        await expect(svc.update(TENANT, INSP_A, b.id, { name: 'Z' })).rejects.toMatchObject({ status: 404 });
        await expect(svc.update(TENANT, INSP_A, foreign.id, { name: 'Z' })).rejects.toMatchObject({ status: 404 });
        await expect(svc.update(TENANT, INSP_A, 'missing', { name: 'Z' })).rejects.toMatchObject({ status: 404 });
        expect(await rows()).toEqual(before);
    });
    it('update: control, the unit\'s own inspection renames it', async () => {
        await svc.update(TENANT, INSP_A, a.id, { name: 'Renamed' });
        expect((await rows()).find((r) => r.id === a.id)!.name).toBe('Renamed');
    });
    it('delete: a unit of another inspection or company is not found and nothing cascades', async () => {
        const before = await rows();
        await expect(svc.delete(TENANT, INSP_A, b.id)).rejects.toMatchObject({ status: 404 });
        await expect(svc.delete(TENANT, INSP_A, foreign.id)).rejects.toMatchObject({ status: 404 });
        expect(await rows()).toEqual(before);
    });
    it('delete: control, cascades children inside its own inspection only', async () => {
        await svc.delete(TENANT, INSP_B, b.id);
        const ids = (await rows()).map((r) => r.id);
        expect(ids).not.toContain(b.id);
        expect(ids).not.toContain(bChild.id);
        expect(ids).toEqual(expect.arrayContaining([a.id, aChild.id, foreign.id]));
    });
    it('move: a unit of another inspection is not found; a foreign parent is refused; nothing changes', async () => {
        const before = await rows();
        await expect(svc.move(TENANT, INSP_A, b.id, null, 1)).rejects.toMatchObject({ status: 404 });
        await expect(svc.move(TENANT, INSP_A, aChild.id, b.id, 1)).rejects.toThrow(/parent unit not found/i);
        await expect(svc.move(TENANT, INSP_A, aChild.id, foreign.id, 1)).rejects.toThrow(/parent unit not found/i);
        expect(await rows()).toEqual(before);
    });
    it('move: control, reparent within the inspection and to the top level', async () => {
        const c = await svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: null, kind: 'building', name: 'C' });
        await svc.move(TENANT, INSP_A, aChild.id, c.id, 3);
        expect((await rows()).find((r) => r.id === aChild.id)).toMatchObject({ parentUnitId: c.id, sortOrder: 3 });
        await svc.move(TENANT, INSP_A, aChild.id, null, 4);
        expect((await rows()).find((r) => r.id === aChild.id)).toMatchObject({ parentUnitId: null, sortOrder: 4 });
    });
    it('create and createMany: a parent of another inspection or company is refused', async () => {
        const before = await rows();
        await expect(svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: b.id, kind: 'floor', name: 'N' })).rejects.toThrow(/parent unit not found/i);
        await expect(svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: foreign.id, kind: 'floor', name: 'N' })).rejects.toThrow(/parent unit not found/i);
        await expect(svc.createMany(TENANT, INSP_A, [{ label: '1', floor: null }], { parentUnitId: b.id })).rejects.toThrow(/parent unit not found/i);
        expect(await rows()).toEqual(before);
    });
    it('create and createMany: control, a parent of the same inspection works', async () => {
        await svc.create(TENANT, { inspectionId: INSP_A, parentUnitId: a.id, kind: 'floor', name: 'N' });
        const many = await svc.createMany(TENANT, INSP_A, [{ label: '1', floor: null }], { parentUnitId: a.id });
        expect(many.ids).toHaveLength(1);
    });
});
