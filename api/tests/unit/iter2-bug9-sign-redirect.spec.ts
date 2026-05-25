import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { AgreementService } from '../../src/services/agreement.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const INSP_ID  = '00000000-0000-0000-0000-000000000010';
const INSP_B   = '00000000-0000-0000-0000-000000000011';
const AGR_ID   = '00000000-0000-0000-0000-000000000020';

async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', subdomain: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: true, createdAt: new Date() },
        { id: INSP_B, tenantId: TENANT_B, propertyAddress: '2 Other St', clientName: 'Bob', clientEmail: 'bob@test.com', date: '2026-06-02', status: 'draft', paymentStatus: 'unpaid', price: 30000, agreementRequired: true, paymentRequired: true, createdAt: new Date() },
    ]);
    await testDb.insert(schema.agreements).values([
        { id: AGR_ID, tenantId: TENANT_A, name: 'Standard', content: 'Agreement text...', version: 1, createdAt: new Date() },
    ]);
}

/**
 * iter-2 production bug #9 — Sprint 1 D-7 ReportGatePage minted CTA URLs
 * `${baseUrl}/sign/${id}` (with id = inspection id), but no route was
 * registered. The customer who hit the gate landed on a 404.
 *
 * The fix adds a public `/sign/:id` redirect route that resolves the
 * inspection's pending agreement-signing request and 302s to the canonical
 * `/agreements/sign/:token` page. This spec pins the service-level
 * lookup that powers the redirect: tenant-scoped, terminal-state aware,
 * most-recent-first.
 */
describe('iter-2 #9 — AgreementService.findPendingByInspectionId', () => {
    let svc: AgreementService;
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: { close: () => void };

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        sqlite = fixture.sqlite;
        await setupSchema(fixture.sqlite);
        await seedBase(testDb);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new AgreementService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('returns null when no agreement_request exists for the inspection', async () => {
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result).toBeNull();
    });

    it('returns the token for a pending request', async () => {
        const reqId = '00000000-0000-0000-0000-000000000100';
        const token = 'pending-token-1';
        await testDb.insert(schema.agreementRequests).values({
            id: reqId,
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            agreementId: AGR_ID,
            clientEmail: 'jane@test.com',
            clientName: 'Jane',
            token,
            status: 'pending',
            createdAt: new Date(),
        });
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result?.token).toBe(token);
    });

    it('returns the token for a sent request', async () => {
        const token = 'sent-token-1';
        await testDb.insert(schema.agreementRequests).values({
            id: '00000000-0000-0000-0000-000000000101',
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            agreementId: AGR_ID,
            clientEmail: 'jane@test.com',
            clientName: 'Jane',
            token,
            status: 'sent',
            sentAt: new Date(),
            createdAt: new Date(),
        });
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result?.token).toBe(token);
    });

    it('returns the token for a viewed request', async () => {
        const token = 'viewed-token-1';
        await testDb.insert(schema.agreementRequests).values({
            id: '00000000-0000-0000-0000-000000000102',
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            agreementId: AGR_ID,
            clientEmail: 'jane@test.com',
            clientName: 'Jane',
            token,
            status: 'viewed',
            viewedAt: new Date(),
            createdAt: new Date(),
        });
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result?.token).toBe(token);
    });

    it('returns null when the only request is signed (terminal)', async () => {
        await testDb.insert(schema.agreementRequests).values({
            id: '00000000-0000-0000-0000-000000000103',
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            agreementId: AGR_ID,
            clientEmail: 'jane@test.com',
            token: 'signed-token',
            status: 'signed',
            signedAt: new Date(),
            signatureBase64: 'data:image/png;base64,XX',
            createdAt: new Date(),
        });
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result).toBeNull();
    });

    it('returns null when the only request is declined or expired', async () => {
        await testDb.insert(schema.agreementRequests).values([
            {
                id: '00000000-0000-0000-0000-000000000104',
                tenantId: TENANT_A,
                inspectionId: INSP_ID,
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                token: 'declined-token',
                status: 'declined',
                createdAt: new Date(),
            },
            {
                id: '00000000-0000-0000-0000-000000000105',
                tenantId: TENANT_A,
                inspectionId: INSP_ID,
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                token: 'expired-token',
                status: 'expired',
                createdAt: new Date(),
            },
        ]);
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result).toBeNull();
    });

    it('does NOT leak across tenants', async () => {
        // Pending request exists for tenant B's inspection
        await testDb.insert(schema.agreementRequests).values({
            id: '00000000-0000-0000-0000-000000000106',
            tenantId: TENANT_B,
            inspectionId: INSP_B,
            agreementId: AGR_ID, // agreement template doesn't have FK enforcement on tenant
            clientEmail: 'bob@test.com',
            token: 'tenant-b-token',
            status: 'pending',
            createdAt: new Date(),
        });
        // Tenant A queries for tenant B's inspection — must NOT find it
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_B);
        expect(result).toBeNull();
    });

    it('prefers the most recent non-terminal request when multiple exist', async () => {
        const olderTime = new Date(Date.now() - 60_000);
        const newerTime = new Date();
        await testDb.insert(schema.agreementRequests).values([
            {
                id: '00000000-0000-0000-0000-000000000107',
                tenantId: TENANT_A,
                inspectionId: INSP_ID,
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                token: 'older-token',
                status: 'pending',
                createdAt: olderTime,
            },
            {
                id: '00000000-0000-0000-0000-000000000108',
                tenantId: TENANT_A,
                inspectionId: INSP_ID,
                agreementId: AGR_ID,
                clientEmail: 'jane@test.com',
                token: 'newer-token',
                status: 'pending',
                createdAt: newerTime,
            },
        ]);
        const result = await svc.findPendingByInspectionId(TENANT_A, INSP_ID);
        expect(result?.token).toBe('newer-token');
    });
});
