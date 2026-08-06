/**
 * A client changing scope at the door is routine — add a sewer scope, drop the
 * pool inspection, decline the radon. That used to hard-delete the billing line,
 * which was harmless only while nothing hung off one.
 *
 * The fourth test here is the one the plan predicted would be forgotten: adding
 * `is_active` is worthless unless every READER filters on it, and the money
 * chain is the reader that matters. A line the client declined must stop being
 * summed into what the inspection is worth.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import { ServiceService } from '../../../server/services/service.service';

const TENANT = 'tenant-lines-1';
const INSP = 'insp-lines-1';
const SVC = 'svc-sewer';

describe('inspection service lines — scope changes at the door', () => {
    let db: BetterSQLite3Database<typeof schema>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let sqlite: any;
    let svc: ServiceService;

    const lineRows = () => db.select().from(schema.inspectionServices)
        .where(eq(schema.inspectionServices.inspectionId, INSP)).all();

    beforeEach(async () => {
        const setup = createTestDb();
        db = setup.db;
        sqlite = setup.sqlite;
        await setupSchema(sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(db);

        await db.insert(schema.tenants).values({
            id: TENANT, name: 'T', slug: 't', createdAt: new Date(),
        });
        await db.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 Main St', date: '2026-09-01',
            status: 'confirmed', paymentStatus: 'unpaid', price: 40000, createdAt: new Date(),
        });
        await db.insert(schema.services).values({
            id: SVC, tenantId: TENANT, name: 'Sewer Scope', description: null,
            price: 25000, durationMinutes: 60, templateId: null, agreementId: null,
            active: true, sortOrder: 1, createdAt: new Date(), defaultEventTypeSlugs: [],
        } as never);

        svc = new ServiceService({} as never);
    });

    afterEach(() => { sqlite.close(); });

    it('soft-deletes a line so the history of what was sold survives', async () => {
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        await svc.removeInspectionService(TENANT, INSP, line!.id);

        const rows = await lineRows();
        expect(rows).toHaveLength(1);          // still present
        expect(rows[0].active).toBe(false);    // but not live
    });

    it('hides a removed line from the live list', async () => {
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        expect(await svc.getInspectionServices(TENANT, INSP)).toHaveLength(1);

        await svc.removeInspectionService(TENANT, INSP, line!.id);
        expect(await svc.getInspectionServices(TENANT, INSP)).toHaveLength(0);
    });

    it('refuses to remove the same line twice', async () => {
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        await svc.removeInspectionService(TENANT, INSP, line!.id);

        // A silent second success would tell an operator they removed something
        // that was already gone.
        await expect(svc.removeInspectionService(TENANT, INSP, line!.id))
            .rejects.toThrow(/not found/i);
    });

    it('excludes an inactive line from the effective price sum', async () => {
        // THE one that gets forgotten. `getEffectivePriceCents` is a pure
        // function over already-fetched lines, so the filter has to live at
        // every fetch site — this asserts the one the service layer owns.
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        const before = await svc.getInspectionServices(TENANT, INSP);
        expect(before.reduce((n, l) => n + (l.priceOverride ?? l.priceSnapshot), 0)).toBe(25000);

        await svc.removeInspectionService(TENANT, INSP, line!.id);

        const after = await svc.getInspectionServices(TENANT, INSP);
        expect(after.reduce((n, l) => n + (l.priceOverride ?? l.priceSnapshot), 0)).toBe(0);
    });

    it('reactivates the original row when a declined service is wanted after all', async () => {
        // Not a second row: a reports row or a pay split may already point at
        // this id, and a fresh one would strand them while the client is billed
        // for the line they can see.
        const first = await svc.addInspectionService(TENANT, INSP, SVC);
        await svc.removeInspectionService(TENANT, INSP, first!.id);

        const again = await svc.addInspectionService(TENANT, INSP, SVC);

        expect(again!.id).toBe(first!.id);
        expect(await lineRows()).toHaveLength(1);
        expect(await svc.getInspectionServices(TENANT, INSP)).toHaveLength(1);
    });

    it('refuses to remove a line that a report delivers, and says so', async () => {
        // The deferral written at removeInspectionService came due when the
        // `reports` table landed: a soft delete would leave the report pointing
        // at a line that is no longer on the invoice, and nothing surfaces it
        // (no FKs by design). The refusal must NAME what blocked it.
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        await db.insert(schema.reports).values({
            id: 'rep-sewer-1', tenantId: TENANT, inspectionId: INSP,
            kind: 'ancillary', inspectionServiceId: line!.id,
            title: 'Sewer Scope', status: 'in_progress', createdAt: new Date(),
        });

        await expect(svc.removeInspectionService(TENANT, INSP, line!.id))
            .rejects.toThrow(/report/i);

        // Refused means untouched — not a silent no-op that flipped the flag.
        const rows = await lineRows();
        expect(rows[0].active).toBe(true);
    });

    it('still removes a line whose reports belong to other lines', async () => {
        // The block is the line's OWN report. A published primary report for the
        // main inspection must not freeze every other line on the order.
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        await db.insert(schema.reports).values({
            id: 'rep-primary-1', tenantId: TENANT, inspectionId: INSP,
            kind: 'primary', inspectionServiceId: null,
            title: 'Home Inspection', status: 'published', createdAt: new Date(),
        });

        await svc.removeInspectionService(TENANT, INSP, line!.id);
        expect((await lineRows())[0].active).toBe(false);
    });

    it('never touches another tenant\'s line', async () => {
        const line = await svc.addInspectionService(TENANT, INSP, SVC);
        await expect(svc.removeInspectionService('other-tenant', INSP, line!.id))
            .rejects.toThrow(/not found/i);

        const still = await db.select().from(schema.inspectionServices)
            .where(and(
                eq(schema.inspectionServices.id, line!.id),
                eq(schema.inspectionServices.tenantId, TENANT),
            )).get();
        expect(still?.active).toBe(true);
    });
});
