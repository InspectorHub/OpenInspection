/**
 * InvoiceService.getEarningsSummary must exclude voided invoices from ALL
 * revenue rollups — paid sum, pending sum, and count.
 *
 * Task 7 TDD: RED first (before the void filter is added to getEarningsSummary),
 * then GREEN after the SQL gains AND voided_at IS NULL in each CASE WHEN branch.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceService } from '../../server/services/invoice.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-000000000002';
const INSP   = 'i-void-1';

describe('InvoiceService — void exclusion from earnings', () => {
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
            id: TENANT, name: 'VoidCo', slug: 'voidco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: INSP, tenantId: TENANT, propertyAddress: '2 Void St', date: '2026-06-22',
            status: 'completed', paymentStatus: 'paid', price: 0,
            agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
    });

    it('excludes a voided paid invoice — paid sum and count reflect only the non-voided invoice', async () => {
        // inv-a: paid + voided — must NOT count
        await testDb.insert(schema.invoices).values({
            id: 'inv-a', tenantId: TENANT, inspectionId: INSP,
            amountCents: 30000,
            lineItems: [{ description: 'Inspection', amountCents: 30000 }],
            paidAt:    new Date('2026-06-01'),
            voidedAt:  new Date('2026-06-02'),
            createdAt: new Date(),
        } as never);

        // inv-b: paid, not voided — must count
        await testDb.insert(schema.invoices).values({
            id: 'inv-b', tenantId: TENANT, inspectionId: INSP,
            amountCents: 45000,
            lineItems: [{ description: 'Reinspection', amountCents: 45000 }],
            paidAt:    new Date('2026-06-10'),
            createdAt: new Date(),
        } as never);

        const result = await svc.getEarningsSummary(TENANT);

        // Only inv-b should count
        expect(result.paid).toBe(45000);
        expect(result.count).toBe(1);
    });

    it('counts both paid invoices when neither is voided — deposit+balance additive', async () => {
        // Two paid invoices, no void
        await testDb.insert(schema.invoices).values({
            id: 'inv-c', tenantId: TENANT, inspectionId: INSP,
            amountCents: 20000,
            lineItems: [{ description: 'Deposit', amountCents: 20000 }],
            paidAt:    new Date('2026-06-01'),
            createdAt: new Date(),
        } as never);

        await testDb.insert(schema.invoices).values({
            id: 'inv-d', tenantId: TENANT, inspectionId: INSP,
            amountCents: 25000,
            lineItems: [{ description: 'Balance', amountCents: 25000 }],
            paidAt:    new Date('2026-06-10'),
            createdAt: new Date(),
        } as never);

        const result = await svc.getEarningsSummary(TENANT);

        expect(result.paid).toBe(45000);
        expect(result.count).toBe(2);
    });

});


describe('InvoiceService — getStatus void variant', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InvoiceService;
    const T2   = '00000000-0000-0000-0000-000000000003';
    const I2   = 'i-status-void';

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InvoiceService({} as D1Database);

        await testDb.insert(schema.tenants).values({
            id: T2, name: 'StatusCo', slug: 'statusco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.inspections).values({
            id: I2, tenantId: T2, propertyAddress: '3 Status Ave', date: '2026-06-22',
            status: 'completed', paymentStatus: 'paid', price: 0,
            agreementRequired: false, paymentRequired: false, createdAt: new Date(),
        });
    });

    it('returns status="void" for an invoice that has voidedAt set (even if also paidAt)', async () => {
        await testDb.insert(schema.invoices).values({
            id: 'inv-void-status', tenantId: T2, inspectionId: I2,
            amountCents: 10000,
            lineItems: [],
            paidAt:    new Date('2026-06-01'),
            voidedAt:  new Date('2026-06-02'),
            createdAt: new Date(),
        } as never);

        const inv = await svc.findByInspectionId(T2, I2);
        // Must be 'void', not 'paid' — discriminating: remove voidedAt guard → 'paid'
        expect(inv?.status).toBe('void');
    });

    it('returns status="paid" for an invoice with paidAt but no voidedAt', async () => {
        await testDb.insert(schema.invoices).values({
            id: 'inv-paid-status', tenantId: T2, inspectionId: I2,
            amountCents: 10000,
            lineItems: [],
            paidAt:    new Date('2026-06-01'),
            createdAt: new Date(),
        } as never);

        const inv = await svc.findByInspectionId(T2, I2);
        expect(inv?.status).toBe('paid');
    });
});
