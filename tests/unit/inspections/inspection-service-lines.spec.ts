/**
 * IA-87 — the write face for `inspection_services`.
 *
 * Before this existed, service lines were written exactly once, at inspection
 * creation, and were unreachable afterwards: an inspection booked without
 * services could never be made billable except by editing the denormalized
 * `inspections.price` cache from inside the report editor.
 *
 * The cases worth pinning are the ones a reader cannot infer from the method
 * names: prices are SNAPSHOTS (repricing the catalog must not silently change
 * what an inspection already booked), adding twice must not bill twice, and a
 * cross-tenant id pairing must produce no row at all.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { ServiceService } from '../../../server/services/service.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTHER_TENANT = '00000000-0000-0000-0000-000000000002';
const INSP_ID = '550e8400-e29b-41d4-a716-446655440000';
const SVC_ID = '00000000-0000-0000-0000-0000000000a1';
const FOREIGN_SVC_ID = '00000000-0000-0000-0000-0000000000a2';

let db: BetterSQLite3Database<typeof schema>;
let svc: ServiceService;

const linesOf = (inspectionId: string) =>
    db.select().from(schema.inspectionServices)
        .where(eq(schema.inspectionServices.inspectionId, inspectionId)).all();

describe('ServiceService — service lines on an inspection (IA-87)', () => {
    beforeEach(async () => {
        const fixture = createTestDb();
        db = fixture.db;
        await setupSchema(fixture.sqlite);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);

        for (const [id, name, slug] of [[TENANT, 'Acme', 'acme'], [OTHER_TENANT, 'Other', 'other']] as const) {
            await db.insert(schema.tenants).values({
                id, name, slug, status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
            });
        }
        await db.insert(schema.inspections).values({
            id: INSP_ID, tenantId: TENANT, propertyAddress: '1 Main St',
            date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
        await db.insert(schema.services).values({
            id: SVC_ID, tenantId: TENANT, name: 'Radon test', price: 15000,
            active: true, sortOrder: 0, createdAt: new Date(),
        });
        await db.insert(schema.services).values({
            id: FOREIGN_SVC_ID, tenantId: OTHER_TENANT, name: 'Somebody else\'s service', price: 99900,
            active: true, sortOrder: 0, createdAt: new Date(),
        });

        svc = new ServiceService({} as D1Database);
    });

    it('snapshots the catalog name and price onto the line', async () => {
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        const [line] = await linesOf(INSP_ID);
        expect(line.nameSnapshot).toBe('Radon test');
        expect(line.priceSnapshot).toBe(15000);
        expect(line.priceOverride).toBeNull();
    });

    it('holds the snapshot when the catalog price later changes', async () => {
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);
        await svc.updateService(TENANT, SVC_ID, { price: 20000 });

        const [line] = await linesOf(INSP_ID);
        expect(line.priceSnapshot).toBe(15000);
    });

    it('accepts a per-inspection override at add time without touching the catalog', async () => {
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID, 9900);

        const [line] = await linesOf(INSP_ID);
        expect(line.priceOverride).toBe(9900);
        expect(line.priceSnapshot).toBe(15000);

        const catalog = await db.select().from(schema.services).where(eq(schema.services.id, SVC_ID)).get();
        expect(catalog?.price).toBe(15000);
    });

    it('adding the same service twice bills once', async () => {
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        expect(await linesOf(INSP_ID)).toHaveLength(1);
    });

    it('refuses a service belonging to another tenant, writing no row', async () => {
        await expect(svc.addInspectionService(TENANT, INSP_ID, FOREIGN_SVC_ID)).rejects.toThrow();
        expect(await linesOf(INSP_ID)).toHaveLength(0);
    });

    it('refuses to add to an inspection belonging to another tenant', async () => {
        await expect(svc.addInspectionService(OTHER_TENANT, INSP_ID, SVC_ID)).rejects.toThrow();
        expect(await linesOf(INSP_ID)).toHaveLength(0);
    });

    it('reprices a line, and a null clears the override back to the snapshot', async () => {
        const added = await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        await svc.setInspectionServicePrice(TENANT, INSP_ID, added.id, 12500);
        expect((await linesOf(INSP_ID))[0].priceOverride).toBe(12500);

        await svc.setInspectionServicePrice(TENANT, INSP_ID, added.id, null);
        expect((await linesOf(INSP_ID))[0].priceOverride).toBeNull();
    });

    it('will not reprice a line from another tenant', async () => {
        const added = await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        await expect(svc.setInspectionServicePrice(OTHER_TENANT, INSP_ID, added.id, 1)).rejects.toThrow();
        expect((await linesOf(INSP_ID))[0].priceOverride).toBeNull();
    });

    it('removes a line without touching the catalog service', async () => {
        const added = await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);
        await svc.removeInspectionService(TENANT, INSP_ID, added.id);

        // Removal is now a SOFT delete — the row survives so a reports row or a
        // pay split pointing at it still resolves, and so the history of what
        // was sold outlives a scope change at the door. It is gone from the live
        // list, which is what every reader consumes.
        expect(await svc.getInspectionServices(TENANT, INSP_ID)).toHaveLength(0);
        const raw = await linesOf(INSP_ID);
        expect(raw).toHaveLength(1);
        expect(raw[0].active).toBe(false);

        const catalog = await db.select().from(schema.services).where(eq(schema.services.id, SVC_ID)).get();
        expect(catalog?.active).toBe(true);
    });

    it('will not remove a line from another tenant', async () => {
        const added = await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        await expect(svc.removeInspectionService(OTHER_TENANT, INSP_ID, added.id)).rejects.toThrow();
        expect(await linesOf(INSP_ID)).toHaveLength(1);
    });

    it('leaves inspections.price alone — the line sum outranks that cache, never the reverse', async () => {
        await svc.addInspectionService(TENANT, INSP_ID, SVC_ID);

        const insp = await db.select().from(schema.inspections).where(eq(schema.inspections.id, INSP_ID)).get();
        expect(insp?.price).toBe(0);
    });
});
