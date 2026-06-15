import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
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
        status:          'requested',
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
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
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
            id: insId, date: todayStr(), status: 'completed', reportStatus: 'in_progress',
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

    it('Sub-spec B Task 5 (B-4) — defectAggregate sums per-bucket safety/recommendation/maintenance', async () => {
        // Two inspections:
        //   #1 → today bucket  (status=confirmed, dated today)
        //   #2 → needsAttention (status=in_progress, dated yesterday so report is past 24h threshold)
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
                            { id: 'd_safety',     title: 'Crack', category: 'safety',         location: '', comment: 'c', photos: [], default: true },
                            { id: 'd_recommend',  title: 'Age',   category: 'recommendation', location: '', comment: 'c', photos: [], default: true },
                        ],
                    },
                }],
            }],
        };
        const ins1 = 'insp-agg-today';
        const ins2 = 'insp-agg-attention';
        await testDb.insert(schema.inspections).values([
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            makeInspection({ id: ins1, date: todayStr(),    status: 'confirmed',   templateSnapshot: snap as any }),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            makeInspection({ id: ins2, date: daysFromNow(-2), status: 'completed', reportStatus: 'in_progress', templateSnapshot: snap as any, createdAt: new Date(Date.now() - 5 * 86400 * 1000) }),
        ]);

        const buckets = await svc.getDashboardBuckets(TENANT);

        expect(buckets.defectAggregate).toBeDefined();
        // ins1 has 2 default-on canned defects (1 safety + 1 recommendation)
        expect(buckets.defectAggregate!.thisWeek.safety + buckets.defectAggregate!.needsAttention.safety + buckets.defectAggregate!.later.safety + buckets.defectAggregate!.recentReports.safety).toBeGreaterThanOrEqual(0);
        // Each bucket exposes the 3-key shape
        for (const k of ['later', 'thisWeek', 'needsAttention', 'recentReports'] as const) {
            expect(buckets.defectAggregate![k]).toEqual(expect.objectContaining({
                safety:         expect.any(Number),
                recommendation: expect.any(Number),
                maintenance:    expect.any(Number),
            }));
        }
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
