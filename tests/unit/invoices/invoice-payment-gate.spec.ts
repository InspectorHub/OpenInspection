/**
 * InvoiceService refund/delete must clear a now-stale inspections.payment_status
 * = 'paid' report gate when no paid invoice remains for the inspection — else the
 * report stays publicly unlocked with no backing payment.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceService } from '../../../server/services/invoice.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000001';
const INSP = 'i-1';

async function paymentStatus(db: BetterSQLite3Database<typeof schema>): Promise<string> {
    const row = await db.select({ p: schema.inspections.paymentStatus }).from(schema.inspections)
        .where(eq(schema.inspections.id, INSP)).get();
    return row!.p;
}

describe('InvoiceService — report payment gate sync', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InvoiceService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InvoiceService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '1 St', date: '2026-06-01',
            status: 'completed', paymentStatus: 'paid', price: 0,
            agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
    });

    async function seedPaidInvoice(id: string) {
        await testDb.insert(schema.invoices).values({
            id, tenantId: TENANT, inspectionId: INSP, amountCents: 5000,
            lineItems: [{ description: 'x', amountCents: 5000 }], paidAt: new Date(), createdAt: new Date(),
        } as never);
    }

    it('refunding the only paid invoice downgrades a stale paid gate to unpaid', async () => {
        await seedPaidInvoice('inv-1');
        await svc.markRefunded('inv-1', TENANT);
        expect(await paymentStatus(testDb)).toBe('unpaid');
    });

    it('deleting the only paid invoice downgrades a stale paid gate to unpaid', async () => {
        await seedPaidInvoice('inv-1');
        await svc.deleteInvoice('inv-1', TENANT);
        expect(await paymentStatus(testDb)).toBe('unpaid');
    });

    it('leaves the gate paid when another paid invoice remains', async () => {
        await seedPaidInvoice('inv-1');
        await seedPaidInvoice('inv-2');
        await svc.markRefunded('inv-1', TENANT);
        expect(await paymentStatus(testDb)).toBe('paid');
    });

    it('voiding one of two paid invoices keeps the gate paid (non-voided paid invoice remains)', async () => {
        await seedPaidInvoice('inv-1');
        await seedPaidInvoice('inv-2');
        // Void inv-1 (deleteInvoice sets voidedAt); inv-2 remains paid and non-voided.
        await svc.deleteInvoice('inv-1', TENANT);
        expect(await paymentStatus(testDb)).toBe('paid');
    });
});
