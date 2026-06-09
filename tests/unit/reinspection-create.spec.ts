import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { ReportVersionService } from '../../server/services/report-version.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq as schema_eq } from 'drizzle-orm';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT   = '00000000-0000-0000-0000-000000000099';
const ORIGINAL = '11111111-1111-1111-1111-111111111111';
const DRAFT    = '22222222-2222-2222-2222-222222222222';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: 'user-a', tenantId: TENANT, email: 'insp@example.com',
        passwordHash: 'x', name: 'Inspector A', createdAt: new Date(),
    });

    // Published ORIGINAL inspection.
    await testDb.insert(schema.inspections).values({
        id: ORIGINAL, tenantId: TENANT,
        propertyAddress: '1 Main St', clientName: 'Jane Buyer',
        clientEmail: 'jane@example.com', date: '2026-06-01',
        status: 'published', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    // Its r1 snapshot. snapshotOnPublish stores { inspection, data, units };
    // createReinspection parses .data[itemId].
    const snapshot = {
        inspection: { id: ORIGINAL },
        data: {
            'item-a': { rating: 'defect', notes: 'cracked', photos: ['p1'] },
            'item-b': { rating: 'defect', notes: 'leak', photos: [] },
        },
        units: [],
    };
    await testDb.insert(schema.reportVersions).values({
        id: crypto.randomUUID(), tenantId: TENANT, inspectionId: ORIGINAL,
        versionNumber: 1, snapshotJson: JSON.stringify(snapshot),
        publishedAt: Math.floor(Date.now() / 1000), publishedBy: 'user-a',
        createdAt: new Date().toISOString(),
    });

    // DRAFT inspection with NO report_versions row (gate test).
    await testDb.insert(schema.inspections).values({
        id: DRAFT, tenantId: TENANT,
        propertyAddress: '2 Side St', date: '2026-06-02',
        status: 'draft', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('InspectionService.createReinspection (#119)', () => {
    let svc: InspectionService;
    let reportVersionSvc: ReportVersionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new InspectionService({} as D1Database);
        reportVersionSvc = new ReportVersionService({} as D1Database, 'test-encryption-secret-key');
    });

    it('creates a linked re-inspection seeding only the selected items', async () => {
        const out = await svc.createReinspection(TENANT, ORIGINAL, {
            selectedItemIds: ['item-a'], inspectorId: 'user-a',
        });
        expect(out.sourceInspectionId).toBe(ORIGINAL);
        expect(out.rootInspectionId).toBe(ORIGINAL);
        expect(out.reinspectionRound).toBe(1);

        const results = await testDb.select().from(schema.inspectionResults)
            .where(schema_eq(schema.inspectionResults.inspectionId, out.id)).get();
        // inspection_results.data is a json-mode column — drizzle returns it parsed.
        const raw = results!.data as unknown;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw as Record<string, any>;
        expect(Object.keys(data)).toEqual(['item-a']);
        expect(data['item-a'].original.notes).toBe('cracked');
        expect(data['item-a'].followupStatus).toBeNull();
    });

    it('a second re-inspection based on the first keeps root + increments round', async () => {
        const r1 = await svc.createReinspection(TENANT, ORIGINAL, { selectedItemIds: ['item-a'], inspectorId: 'user-a' });
        await reportVersionSvc.snapshotOnPublish(TENANT, r1.id, 'user-a');
        const r2 = await svc.createReinspection(TENANT, r1.id, { selectedItemIds: ['item-a'], inspectorId: 'user-a' });
        expect(r2.rootInspectionId).toBe(ORIGINAL);
        expect(r2.reinspectionRound).toBe(2);
    });

    it('rejects creating a re-inspection from an unpublished baseline', async () => {
        await expect(svc.createReinspection(TENANT, DRAFT, { selectedItemIds: ['x'], inspectorId: 'user-a' }))
            .rejects.toThrow(/published/i);
    });

    it('rejects an inspectorId that does not belong to the tenant', async () => {
        await expect(svc.createReinspection(TENANT, ORIGINAL, {
            selectedItemIds: ['item-a'], inspectorId: 'ghost-user',
        })).rejects.toThrow(/inspector/i);
    });

    it('accepts a valid seeded tenant user as inspectorId', async () => {
        const out = await svc.createReinspection(TENANT, ORIGINAL, {
            selectedItemIds: ['item-a'], inspectorId: 'user-a',
        });
        expect(out.inspectorId).toBe('user-a');
    });
});
