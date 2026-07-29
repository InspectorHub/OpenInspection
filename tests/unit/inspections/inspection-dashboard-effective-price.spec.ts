/**
 * Dashboard rows must report the P-4 effective price, not the cached column.
 *
 * The bug (IA-131): `getDashboardBuckets` returned each inspection row as-is, so
 * the price the busiest list in the app rendered was `inspections.price_cents` —
 * tier 3, the denormalized cache. On seeded production-shaped data that column
 * held 0 for two inspections whose invoices said $450 and $380, and the list
 * announced "$0" for both.
 *
 * Worth stating why the UI could not defend itself: the row renders only when
 * `price != null`, and the cache holds 0, not NULL. There was no "unknown" state
 * to fall back to — a wrong number was the only thing it could show.
 *
 * These assertions are deliberately about the DIFFERENCE between the tiers. Every
 * fixture below sets `price: 0` and puts the real money somewhere higher up the
 * chain, so nothing here can pass by accident if the cache is read again.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionAnalyticsService } from '../../../server/services/inspection/inspection-analytics.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));

const TENANT = '00000000-0000-0000-0000-0000000000f1';
const facadeStub = {} as unknown as import('../../../server/services/inspection.service').InspectionService;

/** Every bucket that carries decorated rows, flattened — the price fix lives in
 *  `decorate`, so which bucket a fixture lands in must not matter. */
function allRows(r: Awaited<ReturnType<InspectionAnalyticsService['getDashboardBuckets']>>) {
    return [...r.recentReports, ...r.needsAttention, ...r.today, ...r.thisWeek, ...r.later, ...r.cancelled];
}

describe('dashboard rows — P-4 effective price (IA-131)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionAnalyticsService;

    beforeEach(async () => {
        const fix = createTestDb();
        testDb = fix.db;
        await setupSchema(fix.sqlite);
        const { drizzle } = await import('drizzle-orm/d1');
        (drizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(testDb);
        svc = new InspectionAnalyticsService({} as D1Database, undefined, undefined, undefined, undefined, facadeStub);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'PriceCo', slug: 'priceco',
            status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
        });
        await testDb.insert(schema.services).values({
            id: 'svc-cat', tenantId: TENANT, name: 'Catalog', price: 0, createdAt: new Date(),
        } as never);
    });

    async function seedInspection(id: string) {
        await testDb.insert(schema.inspections).values({
            id, tenantId: TENANT, propertyAddress: id,
            date: '2030-01-01', status: 'scheduled', paymentStatus: 'unpaid',
            // The cache says this job is worth nothing. Every case below proves
            // the dashboard no longer believes it.
            price: 0, agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });
    }

    it('reports the invoice amount, not the $0 cache', async () => {
        await seedInspection('i-inv');
        await testDb.insert(schema.invoices).values({
            id: 'inv-1', tenantId: TENANT, inspectionId: 'i-inv',
            amountCents: 45_000,
            lineItems: [{ description: 'Inspection', amountCents: 45_000 }],
            createdAt: new Date(),
        } as never);

        const row = allRows(await svc.getDashboardBuckets(TENANT)).find(r => r.id === 'i-inv');
        expect(row?.price).toBe(45_000);
    });

    it('falls to the service bundle when there is no invoice, honouring per-line overrides', async () => {
        await seedInspection('i-svc');
        await testDb.insert(schema.inspectionServices).values([
            { id: 's1', tenantId: TENANT, inspectionId: 'i-svc', serviceId: 'svc-cat', nameSnapshot: 'A', priceSnapshot: 20_000, priceOverride: 12_500 },
            { id: 's2', tenantId: TENANT, inspectionId: 'i-svc', serviceId: 'svc-cat', nameSnapshot: 'B', priceSnapshot: 5_000, priceOverride: null },
        ] as never);

        const row = allRows(await svc.getDashboardBuckets(TENANT)).find(r => r.id === 'i-svc');
        expect(row?.price).toBe(17_500);
    });

    it('ignores a voided invoice and uses the tier below it', async () => {
        await seedInspection('i-void');
        await testDb.insert(schema.invoices).values({
            id: 'inv-void', tenantId: TENANT, inspectionId: 'i-void',
            amountCents: 99_900,
            lineItems: [{ description: 'Inspection', amountCents: 99_900 }],
            voidedAt: new Date(), createdAt: new Date(),
        } as never);
        await testDb.insert(schema.inspectionServices).values({
            id: 's3', tenantId: TENANT, inspectionId: 'i-void', serviceId: 'svc-cat',
            nameSnapshot: 'C', priceSnapshot: 8_000, priceOverride: null,
        } as never);

        const row = allRows(await svc.getDashboardBuckets(TENANT)).find(r => r.id === 'i-void');
        expect(row?.price).toBe(8_000);
    });

    it('keeps the cached price when nothing higher exists', async () => {
        // The cache is still the tier of last resort — this guards against
        // "fixing" the bug by zeroing every row that has no invoice.
        await testDb.insert(schema.inspections).values({
            id: 'i-cache', tenantId: TENANT, propertyAddress: 'i-cache',
            date: '2030-01-01', status: 'scheduled', paymentStatus: 'unpaid',
            price: 33_300, agreementRequired: false, paymentRequired: true, createdAt: new Date(),
        });

        const row = allRows(await svc.getDashboardBuckets(TENANT)).find(r => r.id === 'i-cache');
        expect(row?.price).toBe(33_300);
    });
});
