/**
 * i18n Phase B — the tenant currency-change guard. Switching currency once
 * invoices exist must be a deliberate, confirmed action (the per-invoice snapshot
 * protects history, but the switch itself is a data-integrity decision).
 *
 * Covers the pure predicate `needsCurrencyChangeConfirm` and the real-DB
 * `InvoiceService.countInvoices` it consumes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { needsCurrencyChangeConfirm } from '../../../server/lib/currency-guard';
import { InvoiceService } from '../../../server/services/invoice.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

describe('needsCurrencyChangeConfirm', () => {
    it('blocks: currency changes, invoices exist, not confirmed', () => {
        expect(needsCurrencyChangeConfirm({ current: 'USD', next: 'CAD', invoiceCount: 3, confirmed: false })).toBe(true);
    });
    it('allows once confirmed', () => {
        expect(needsCurrencyChangeConfirm({ current: 'USD', next: 'CAD', invoiceCount: 3, confirmed: true })).toBe(false);
    });
    it('allows when no invoices exist yet', () => {
        expect(needsCurrencyChangeConfirm({ current: 'USD', next: 'CAD', invoiceCount: 0, confirmed: false })).toBe(false);
    });
    it('allows a no-op (same currency)', () => {
        expect(needsCurrencyChangeConfirm({ current: 'USD', next: 'USD', invoiceCount: 9, confirmed: false })).toBe(false);
    });
    it('allows the first-ever currency set (no current)', () => {
        expect(needsCurrencyChangeConfirm({ current: null, next: 'USD', invoiceCount: 9, confirmed: false })).toBe(false);
    });
    it('allows a save that omits currency', () => {
        expect(needsCurrencyChangeConfirm({ current: 'USD', next: undefined, invoiceCount: 9, confirmed: false })).toBe(false);
    });
});

describe('InvoiceService.countInvoices', () => {
    const TENANT = '00000000-0000-0000-0000-0000000000dd';
    let testDb: BetterSQLite3Database<typeof schema>;
    let sqlite: any;
    let svc: InvoiceService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        sqlite = fix.sqlite;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InvoiceService({} as D1Database);
        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Co', slug: 'co', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        } as any);
    });

    afterEach(() => sqlite.close());

    async function addInvoice(id: string) {
        await testDb.insert(schema.invoices).values({
            id, tenantId: TENANT, amountCents: 1000, currency: 'USD', lineItems: [], createdAt: new Date(),
        } as any);
    }

    it('returns 0 for a tenant with no invoices', async () => {
        expect(await svc.countInvoices(TENANT)).toBe(0);
    });

    it('counts every invoice regardless of status', async () => {
        await addInvoice('00000000-0000-0000-0000-0000000000a1');
        await addInvoice('00000000-0000-0000-0000-0000000000a2');
        expect(await svc.countInvoices(TENANT)).toBe(2);
    });

    it('is tenant-scoped — never counts another tenant', async () => {
        await addInvoice('00000000-0000-0000-0000-0000000000a1');
        expect(await svc.countInvoices('00000000-0000-0000-0000-0000000000ee')).toBe(0);
    });
});
