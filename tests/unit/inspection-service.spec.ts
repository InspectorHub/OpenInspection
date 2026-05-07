import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../src/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../src/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000001';

function makeInspection(overrides: Partial<typeof schema.inspections.$inferInsert> & { id: string }) {
    return {
        tenantId:        TENANT,
        propertyAddress: '1 Main St',
        clientName:      'Test Client',
        clientEmail:     'test@example.com',
        date:            '2026-06-01',
        status:          'draft',
        paymentStatus:   'unpaid',
        price:           0,
        paymentRequired: false,
        agreementRequired: false,
        createdAt:       new Date(),
        ...overrides,
    } satisfies typeof schema.inspections.$inferInsert;
}

function todayStr() {
    return new Date().toISOString().slice(0, 10);
}

function daysFromNow(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
}

describe('InspectionService.getDashboardBuckets (Spec 3A)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', subdomain: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);
    });

    it('buckets a today inspection under today', async () => {
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-today-1', date: todayStr(), status: 'confirmed' }),
        ]);

        const buckets = await svc.getDashboardBuckets(TENANT);

        expect(buckets.today.length).toBe(1);
        expect(buckets.today[0].id).toBe('insp-today-1');
        expect(buckets.thisWeek.length).toBe(0);
    });

    it('flags scheduled within 48h as needsAttention', async () => {
        // 24h from now — scheduled, within 48h window
        await testDb.insert(schema.inspections).values([
            makeInspection({ id: 'insp-attention-1', date: daysFromNow(1), status: 'scheduled' }),
        ]);

        const buckets = await svc.getDashboardBuckets(TENANT);

        expect(buckets.needsAttention.length).toBe(1);
        expect(buckets.needsAttention[0].id).toBe('insp-attention-1');
    });

    it('Spec 5B P2B — getDefectStatsBatch counts canned + custom defects per inspection', async () => {
        // Template snapshot with 3 canned defects (1 default-included, 2 default-off).
        const snap = {
            schemaVersion: 2,
            sections: [{
                id: 's', title: 'S', items: [{
                    id: 'item-roof', label: 'Roof', type: 'rich',
                    ratingOptions: ['Inspected'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            { id: 'd_safety',   title: 'Cracking',     category: 'safety',         location: '', comment: 'c1', photos: [], default: true  },
                            { id: 'd_recommend',title: 'Aging',        category: 'recommendation', location: '', comment: 'c2', photos: [], default: false },
                            { id: 'd_maint',    title: 'Cleaning',     category: 'maintenance',    location: '', comment: 'c3', photos: [], default: false },
                        ],
                    },
                }],
            }],
        };
        const insId = 'insp-stats-1';
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await testDb.insert(schema.inspections).values(makeInspection({
            id: insId, date: todayStr(), status: 'in_progress',
            templateSnapshot: snap as any,
        }));
        // Per-inspection state: turn ON d_recommend, leave d_safety default-on,
        // leave d_maint OFF; add a custom safety defect that should also count.
        await testDb.insert(schema.inspectionResults).values({
            id:            'res-1',
            inspectionId:  insId,
            tenantId:      TENANT,
            data:          {
                'item-roof': {
                    tabs: {
                        defects: [
                            { cannedId: 'd_recommend', included: true },
                        ],
                    },
                    customComments: {
                        defects: [
                            { id: 'cu_x', title: 'Custom safety', comment: 'oops', included: true, category: 'safety' },
                            { id: 'cu_y', title: 'Custom off',    comment: 'no',   included: false, category: 'maintenance' },
                        ],
                    },
                },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            lastSyncedAt:  new Date(),
        });

        const map = await svc.getDefectStatsBatch(TENANT, [insId]);
        const stats = map.get(insId);
        expect(stats).toBeDefined();
        // Expected: 1 canned safety (default-on) + 1 custom safety = 2 safety;
        // 1 canned recommend (toggled on) = 1; 0 maintenance.
        expect(stats!.safety).toBe(2);
        expect(stats!.recommendation).toBe(1);
        expect(stats!.maintenance).toBe(0);
    });

    it('caps later at 50 and reports laterTotal', async () => {
        // 55 inspections 30 days out, status confirmed (not cancelled)
        const rows = Array.from({ length: 55 }, (_, i) =>
            makeInspection({ id: `insp-later-${String(i).padStart(3, '0')}`, date: daysFromNow(30), status: 'confirmed' })
        );
        await testDb.insert(schema.inspections).values(rows);

        const buckets = await svc.getDashboardBuckets(TENANT);

        expect(buckets.laterTotal).toBe(55);
        expect(buckets.later.length).toBe(50);
    });
});
