/**
 * Track E1 (ITB §11, UC-ITB-07) — Repair List aggregation.
 *
 * Covers:
 *   - getRepairList aggregates ONLY included canned defects from the
 *     resolved tabs of every section/item.
 *   - Custom (per-inspection) defects are also surfaced.
 *   - Default-on canned defects with no per-inspection state still appear.
 *   - Excluded defects (state.included === false) are dropped.
 *   - Recommendation slug → label resolution.
 *   - Estimate range surfaced per defect; totals sum across all entries.
 *   - showEstimates flag passes through from tenant_configs.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000123';
const INSPECTION_ID = '55555555-5555-5555-5555-555555555555';
const TEMPLATE_ID = '66666666-6666-6666-6666-666666666666';

const TEMPLATE_SCHEMA = {
    schemaVersion: 2,
    sections: [
        {
            id: 'roof',
            title: 'Roof',
            items: [
                {
                    id: 'roof-shingles',
                    label: 'Shingles',
                    type: 'rich',
                    ratingOptions: ['Defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            // default-on, no estimate, no recommendation
                            { id: 'def-default-on', title: 'Worn shingles', category: 'maintenance', location: 'Front slope', comment: 'Worn surface granules.', photos: [], default: true },
                            // default-off — should NOT appear unless toggled
                            { id: 'def-default-off', title: 'Active leak', category: 'safety', location: '', comment: 'Active leak detected.', photos: [], default: false },
                        ],
                    },
                },
            ],
        },
        {
            id: 'electrical',
            title: 'Electrical',
            items: [
                {
                    id: 'elec-panel',
                    label: 'Main Panel',
                    type: 'rich',
                    ratingOptions: ['Defect'],
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            { id: 'def-double-tap', title: 'Double-tap breaker', category: 'safety', location: '', comment: 'Double-tap on breaker 4.', photos: [], default: false },
                        ],
                    },
                },
            ],
        },
    ],
};

async function seedFixture(testDb: BetterSQLite3Database<typeof schema>) {
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.templates).values({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', schema: TEMPLATE_SCHEMA as any, version: 1, createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION_ID, tenantId: TENANT, templateId: TEMPLATE_ID,
        propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('Track E1 — InspectionService.getRepairList', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        await seedFixture(testDb);
    });

    it('returns the default-on canned defect with no inspector state', async () => {
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.defects).toHaveLength(1);
        expect(result.defects[0]!.itemLabel).toBe('Shingles');
        expect(result.defects[0]!.sectionTitle).toBe('Roof');
        expect(result.defects[0]!.category).toBe('maintenance');
        expect(result.defects[0]!.location).toBe('Front slope');
        expect(result.defects[0]!.source).toBe('canned');
        // No estimate / recommendation supplied, so totals stay zero.
        expect(result.totals.maintenance).toBe(1);
        expect(result.totals.safety).toBe(0);
        expect(result.totals.estimateLowSum).toBe(0);
        expect(result.totals.estimateHighSum).toBe(0);
    });

    it('drops a default-on defect when the inspector toggled it off', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                tabs: {
                    defects: [
                        { cannedId: 'def-default-on', included: false },
                    ],
                },
            },
        });
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.defects).toHaveLength(0);
        expect(result.totals.count).toBe(0);
    });

    it('includes a default-off defect when the inspector toggled it on', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                tabs: {
                    defects: [
                        { cannedId: 'def-default-off', included: true, recommendationId: 'roof-leak', estimateLow: 50000, estimateHigh: 150000 },
                    ],
                },
            },
        });
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        // Default-on (worn shingles) + the toggled-on leak.
        expect(result.defects.length).toBe(2);
        const leak = result.defects.find(d => d.itemLabel === 'Shingles' && d.category === 'safety');
        expect(leak).toBeDefined();
        expect(leak!.recommendationId).toBe('roof-leak');
        expect(leak!.recommendationLabel).not.toBe('roof-leak'); // resolved to human-readable label
        expect(leak!.estimateLow).toBe(50000);
        expect(leak!.estimateHigh).toBe(150000);
        expect(result.totals.safety).toBe(1);
        expect(result.totals.estimateLowSum).toBe(50000);
        expect(result.totals.estimateHighSum).toBe(150000);
    });

    it('aggregates defects across multiple sections + items', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'elec-panel': {
                tabs: {
                    defects: [
                        { cannedId: 'def-double-tap', included: true },
                    ],
                },
            },
        });
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        // Roof default + elec toggled-on = 2 entries across 2 sections.
        expect(result.defects.length).toBe(2);
        const sections = new Set(result.defects.map(d => d.sectionTitle));
        expect(sections.has('Roof')).toBe(true);
        expect(sections.has('Electrical')).toBe(true);
    });

    it('surfaces custom (per-inspection) defects', async () => {
        // Bypass updateResults' canned-only sanitizer and write directly so
        // we can simulate a custom defect on the inspection_results.data
        // payload.
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-1',
            inspectionId: INSPECTION_ID,
            tenantId: TENANT,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data: {
                'roof-shingles': {
                    customComments: {
                        defects: [
                            { id: 'cust-1', title: 'Loose flashing', comment: 'Flashing is loose at chimney base.', included: true, category: 'safety' },
                            { id: 'cust-2', title: 'Excluded',       comment: 'should not appear',                  included: false, category: 'maintenance' },
                        ],
                    },
                },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            lastSyncedAt: new Date(),
        });
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        // Default canned (Worn shingles) + custom safety = 2.
        expect(result.defects).toHaveLength(2);
        const custom = result.defects.find(d => d.source === 'custom');
        expect(custom).toBeDefined();
        expect(custom!.itemLabel).toBe('Loose flashing');
        expect(custom!.category).toBe('safety');
        expect(result.totals.safety).toBe(1);
        expect(result.totals.maintenance).toBe(1);
    });

    it('reflects showEstimates from tenant_configs', async () => {
        // Default = false (no row).
        let result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.showEstimates).toBe(false);
        // Insert config with show_estimates = 1.
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, showEstimates: true, updatedAt: new Date(),
        });
        result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.showEstimates).toBe(true);
    });
});
