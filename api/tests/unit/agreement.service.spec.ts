import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../src/services/agreement.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const INSP_ID  = '00000000-0000-0000-0000-000000000010';
const AGR_ID   = '00000000-0000-0000-0000-000000000020';

async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date() },
    ]);
    await testDb.insert(schema.agreements).values([
        { id: AGR_ID, tenantId: TENANT_A, name: 'Standard Agreement', content: 'Agreement text...', version: 1, createdAt: new Date() },
    ]);
}

describe('AgreementService', () => {
    let svc: AgreementService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        await seedBase(testDb);
        (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new AgreementService({} as D1Database);
    });

    it('findOrCreate inserts a new pending agreement_request with token + sent_at', async () => {
        const r = await svc.findOrCreate(TENANT_A, INSP_ID);
        expect(r.token).toBeTruthy();
        expect(r.alreadyExists).toBe(false);
        const rows = await testDb.select().from(schema.agreementRequests).all();
        expect(rows.length).toBe(1);
        expect(rows[0].status).toBe('sent');
        expect(rows[0].sentAt).toBeDefined();
    });

    it('findOrCreate is idempotent — returns existing row on second call', async () => {
        const a = await svc.findOrCreate(TENANT_A, INSP_ID);
        const b = await svc.findOrCreate(TENANT_A, INSP_ID);
        expect(a.token).toBe(b.token);
        expect(b.alreadyExists).toBe(true);
        const rows = await testDb.select().from(schema.agreementRequests).all();
        expect(rows.length).toBe(1);
    });

    it('markViewed transitions sent → viewed; idempotent on viewed', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        const r1 = await svc.markViewed(token);
        expect(r1?.inspectionId).toBe(INSP_ID);
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('viewed');
        expect(after[0].viewedAt).toBeDefined();
        // Idempotent
        const r2 = await svc.markViewed(token);
        expect(r2?.inspectionId).toBe(INSP_ID);
    });

    it('markSigned transitions viewed → signed', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markViewed(token);
        await svc.markSigned(token, 'data:image/png;base64,XXXX', Date.now());
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('signed');
        expect(after[0].signatureBase64).toBe('data:image/png;base64,XXXX');
        expect(after[0].signedAt).toBeDefined();
    });

    it('markDeclined transitions viewed → declined with reason', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markViewed(token);
        await svc.markDeclined(token, 'Price too high');
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('declined');
        // Reason is stored in last_error column (re-purposed for decline reason)
        expect(after[0].lastError).toBe('Price too high');
    });

    it('markSigned on a declined token throws Conflict', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markDeclined(token);
        await expect(svc.markSigned(token, 'sig', Date.now())).rejects.toThrow();
    });

    it('expireOlderThan marks pending/sent/viewed rows older than N days as expired', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        // Backdate sent_at to 20 days ago
        const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await testDb.update(schema.agreementRequests)
            .set({ sentAt: twentyDaysAgo })
            .where(eq(schema.agreementRequests.token, token));
        const count = await svc.expireOlderThan(14);
        expect(count).toBe(1);
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('expired');
    });
});
