import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ApprenticeService } from '../../src/services/apprentice.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT       = '00000000-0000-0000-0000-000000000099';
const INSPECTION   = '11111111-1111-1111-1111-111111111111';
const APPRENTICE   = '22222222-2222-2222-2222-222222222222';
const MENTOR       = '33333333-3333-3333-3333-333333333333';
const ORPHAN       = '44444444-4444-4444-4444-444444444444';

async function seed(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', subdomain: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    // Mentor first (apprentice references mentor_id).
    await testDb.insert(schema.users).values({
        id: MENTOR, tenantId: TENANT, email: 'mentor@acme.test',
        passwordHash: 'x', role: 'lead', createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: APPRENTICE, tenantId: TENANT, email: 'app@acme.test',
        passwordHash: 'x', role: 'apprentice', mentorId: MENTOR, createdAt: new Date(),
    });
    await testDb.insert(schema.users).values({
        id: ORPHAN, tenantId: TENANT, email: 'orphan@acme.test',
        passwordHash: 'x', role: 'apprentice', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION, tenantId: TENANT, inspectorId: MENTOR,
        propertyAddress: '1 Main St', date: '2026-06-01',
        status: 'draft', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('ApprenticeService (subsystem C P2)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: ApprenticeService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        await seed(testDb);
        svc = new ApprenticeService({} as D1Database);
    });

    it('submitForReview inserts pending row with mentor + json-encoded value', async () => {
        const out = await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-1', 'rating', 'defect');
        expect(out.kind).toBe('queued');
        const row = await svc.getById(TENANT, out.reviewId);
        expect(row).toMatchObject({
            apprenticeId: APPRENTICE,
            mentorId:     MENTOR,
            inspectionId: INSPECTION,
            itemId:       'item-1',
            field:        'rating',
            proposedValue:'"defect"',
            status:       'pending',
        });
    });

    it('rejects apprentice without a mentor', async () => {
        await expect(svc.submitForReview(TENANT, ORPHAN, INSPECTION, 'item-1', 'rating', 'sat'))
            .rejects.toThrow(/no mentor/i);
    });

    it('listPendingForMentor returns only this mentor\'s pending rows', async () => {
        await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-1', 'rating', 'sat');
        await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-2', 'rating', 'monitor');
        const out = await svc.listPendingForMentor(TENANT, MENTOR);
        expect(out).toHaveLength(2);
    });

    it('decide approved updates status + decision_at', async () => {
        const sub = await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-1', 'rating', 'defect');
        const out = await svc.decide(TENANT, sub.reviewId, 'approved');
        expect(out.kind).toBe('ok');
        const row = await svc.getById(TENANT, sub.reviewId);
        expect(row?.status).toBe('approved');
        expect(row?.decisionAt).toBeGreaterThan(0);
    });

    it('decide edited stores decision_value as JSON', async () => {
        const sub = await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-1', 'rating', 'defect');
        const out = await svc.decide(TENANT, sub.reviewId, 'edited', 'monitor');
        expect(out.kind).toBe('ok');
        const row = await svc.getById(TENANT, sub.reviewId);
        expect(row?.status).toBe('edited');
        expect(row?.decisionValue).toBe('"monitor"');
    });

    it('decide on missing reviewId returns not_found', async () => {
        const out = await svc.decide(TENANT, 'no-such-review', 'approved');
        expect(out.kind).toBe('not_found');
    });

    it('listPendingForMentor is tenant-scoped (foreign tenant returns empty)', async () => {
        await svc.submitForReview(TENANT, APPRENTICE, INSPECTION, 'item-1', 'rating', 'sat');
        const out = await svc.listPendingForMentor('other-tenant', MENTOR);
        expect(out).toEqual([]);
    });
});
