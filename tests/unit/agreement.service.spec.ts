import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { AgreementService } from '../../server/services/agreement.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const INSP_ID  = '00000000-0000-0000-0000-000000000010';
const AGR_ID   = '00000000-0000-0000-0000-000000000020';

async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', slug: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: false, createdAt: new Date() },
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
        svc = new AgreementService({} as D1Database, { jwtSecret: 'test-secret' });
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

    // Track I-a: findOrCreate now returns a SIGNER token; the signer-level
    // state machine drives the envelope aggregate. The legacy envelope-token
    // markViewed/markSigned/markDeclined remain public (covered separately
    // below via a direct envelope token).
    it('markViewedBySigner transitions sent → viewed; idempotent on viewed', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        const r1 = await svc.markViewedBySigner(token);
        expect(r1?.inspectionId).toBe(INSP_ID);
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('viewed');
        // Idempotent
        const r2 = await svc.markViewedBySigner(token);
        expect(r2?.inspectionId).toBe(INSP_ID);
    });

    it('markSignedBySigner transitions viewed → signed', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markViewedBySigner(token);
        const res = await svc.markSignedBySigner(token, 'data:image/png;base64,XXXX', { signedAtMs: Date.now(), channel: 'remote' });
        expect(res.envelopeStatus).toBe('signed');
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('signed');
        expect(after[0].signatureBase64).toBe('data:image/png;base64,XXXX');
        expect(after[0].signedAt).toBeDefined();
    });

    it('markDeclinedBySigner transitions viewed → declined with reason', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markViewedBySigner(token);
        await svc.markDeclinedBySigner(token, 'Price too high');
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('declined');
        // Reason is stored in last_error column (re-purposed for decline reason)
        expect(after[0].lastError).toBe('Price too high');
    });

    it('markSignedBySigner on a declined signer throws Conflict', async () => {
        const { token } = await svc.findOrCreate(TENANT_A, INSP_ID);
        await svc.markDeclinedBySigner(token);
        await expect(svc.markSignedBySigner(token, 'sig', { signedAtMs: Date.now(), channel: 'remote' })).rejects.toThrow();
    });

    it('legacy envelope-token markViewed/markSigned/markDeclined still work', async () => {
        // Build a legacy single-signer envelope directly (plaintext envelope token).
        const reqId = crypto.randomUUID();
        const envToken = 'legacy-env-token-xyz';
        await testDb.insert(schema.agreementRequests).values({
            id: reqId, tenantId: TENANT_A, inspectionId: INSP_ID, agreementId: AGR_ID,
            clientEmail: 'jane@test.com', clientName: 'Jane', token: envToken,
            status: 'sent', completionPolicy: 'all', createdAt: new Date(),
        });
        const v = await svc.markViewed(envToken);
        expect(v?.inspectionId).toBe(INSP_ID);
        await svc.markSigned(envToken, 'siglegacy', Date.now());
        const row = await testDb.select().from(schema.agreementRequests).where(eq(schema.agreementRequests.id, reqId)).get();
        expect(row!.status).toBe('signed');
        expect(row!.signatureBase64).toBe('siglegacy');
    });

    it('expireOlderThan marks pending/sent/viewed rows older than N days as expired', async () => {
        const { requestId } = await svc.findOrCreate(TENANT_A, INSP_ID);
        // Backdate sent_at to 20 days ago. Match by envelope id — agreement_requests.token
        // is an internal random UUID, NOT the plaintext signer token findOrCreate returns,
        // so a where(token) update matches nothing.
        const twentyDaysAgo = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
        await testDb.update(schema.agreementRequests)
            .set({ sentAt: twentyDaysAgo })
            .where(eq(schema.agreementRequests.id, requestId));
        const count = await svc.expireOlderThan(14);
        expect(count).toBe(1);
        const after = await testDb.select().from(schema.agreementRequests).all();
        expect(after[0].status).toBe('expired');
    });
});
