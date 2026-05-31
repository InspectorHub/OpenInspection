import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { InvoiceService } from '../../server/services/invoice.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-000000000002';
const INSP_ID  = '00000000-0000-0000-0000-000000000010';
const INSP_B   = '00000000-0000-0000-0000-000000000011';

async function seedBase(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values([
        { id: TENANT_A, name: 'A', subdomain: 'a', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        { id: TENANT_B, name: 'B', subdomain: 'b', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
    ]);
    await testDb.insert(schema.inspections).values([
        { id: INSP_ID, tenantId: TENANT_A, propertyAddress: '1 Main St', clientName: 'Jane', clientEmail: 'jane@test.com', date: '2026-06-01', status: 'draft', paymentStatus: 'unpaid', price: 50000, agreementRequired: true, paymentRequired: true, createdAt: new Date() },
        { id: INSP_B, tenantId: TENANT_B, propertyAddress: '2 Other St', clientName: 'Bob', clientEmail: 'bob@test.com', date: '2026-06-02', status: 'draft', paymentStatus: 'unpaid', price: 30000, agreementRequired: true, paymentRequired: true, createdAt: new Date() },
    ]);
}

/**
 * iter-2 production bug #10 — ReportGatePage's "Pay invoice" CTA pointed
 * at `/invoices?inspection=<id>`, a JWT-protected admin route. An
 * unauthenticated customer who clicked the gate CTA was 302'd to /login,
 * a dead end with no signup path.
 *
 * The fix introduces a public `/r/:id/invoice` payment page (token-gated
 * like Sprint 3 S3-2's `/r/:id/repair-request`) that renders the invoice
 * details + payment instructions without requiring auth. This spec pins
 * the service-level `findByInspectionId` lookup that powers the page:
 * tenant-scoped, returns null on miss, surfaces status from sentAt/paidAt.
 */
describe('iter-2 #10 — InvoiceService.findByInspectionId', () => {
    let svc: InvoiceService;
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
        svc = new InvoiceService({} as D1Database);
    });

    afterEach(() => {
        sqlite.close();
        vi.clearAllMocks();
    });

    it('returns null when no invoice exists for the inspection', async () => {
        const result = await svc.findByInspectionId(TENANT_A, INSP_ID);
        expect(result).toBeNull();
    });

    it('returns invoice details + status="draft" when not sent or paid', async () => {
        const invId = '00000000-0000-0000-0000-000000000200';
        await testDb.insert(schema.invoices).values({
            id: invId,
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            clientName: 'Jane',
            clientEmail: 'jane@test.com',
            amountCents: 50000,
            lineItems: [{ description: 'Standard inspection', amountCents: 50000 }],
            createdAt: new Date(),
        });
        const result = await svc.findByInspectionId(TENANT_A, INSP_ID);
        expect(result).not.toBeNull();
        expect(result?.id).toBe(invId);
        expect(result?.amountCents).toBe(50000);
        expect(result?.status).toBe('draft');
    });

    it('returns status="sent" when sentAt is set but not paid', async () => {
        await testDb.insert(schema.invoices).values({
            id: '00000000-0000-0000-0000-000000000201',
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            clientName: 'Jane',
            amountCents: 50000,
            lineItems: [],
            sentAt: new Date(),
            createdAt: new Date(),
        });
        const result = await svc.findByInspectionId(TENANT_A, INSP_ID);
        expect(result?.status).toBe('sent');
    });

    it('returns status="paid" when paidAt is set', async () => {
        await testDb.insert(schema.invoices).values({
            id: '00000000-0000-0000-0000-000000000202',
            tenantId: TENANT_A,
            inspectionId: INSP_ID,
            clientName: 'Jane',
            amountCents: 50000,
            lineItems: [],
            sentAt: new Date(),
            paidAt: new Date(),
            createdAt: new Date(),
        });
        const result = await svc.findByInspectionId(TENANT_A, INSP_ID);
        expect(result?.status).toBe('paid');
    });

    it('does NOT leak invoices across tenants', async () => {
        // Tenant B has an invoice for INSP_B
        await testDb.insert(schema.invoices).values({
            id: '00000000-0000-0000-0000-000000000203',
            tenantId: TENANT_B,
            inspectionId: INSP_B,
            clientName: 'Bob',
            amountCents: 30000,
            lineItems: [],
            createdAt: new Date(),
        });
        // Tenant A queries for tenant B's invoice — must NOT find it
        const result = await svc.findByInspectionId(TENANT_A, INSP_B);
        expect(result).toBeNull();
    });
});
