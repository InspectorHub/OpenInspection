/**
 * i18n Phase B — a new invoice snapshots the tenant's currency at creation, so a
 * later tenant currency change never re-labels a historical invoice.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InvoiceService } from '../../../server/services/invoice.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000cc';

describe('InvoiceService — currency snapshot on creation', () => {
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
            id: TENANT, name: 'CurCo', slug: 'curco', status: 'active',
            deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
    });

    async function seedCurrency(currency: string) {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, currency, createdAt: new Date(), updatedAt: new Date(),
        });
    }

    async function readCurrency(id: string) {
        const row = await testDb.select({ currency: schema.invoices.currency })
            .from(schema.invoices).where(eq(schema.invoices.id, id)).get();
        return row?.currency;
    }

    it("stamps the tenant's currency onto the new invoice", async () => {
        await seedCurrency('CAD');
        const inv = await svc.createInvoice(TENANT, {
            clientName: 'Jane', amountCents: 50000,
            lineItems: [{ description: 'Inspection', amountCents: 50000 }],
        });
        expect(await readCurrency(inv.id)).toBe('CAD');
    });

    it('defaults to USD when the tenant has no config row', async () => {
        const inv = await svc.createInvoice(TENANT, {
            clientName: 'Jane', amountCents: 50000,
            lineItems: [{ description: 'Inspection', amountCents: 50000 }],
        });
        expect(await readCurrency(inv.id)).toBe('USD');
    });
});
