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
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
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
        // clientName/clientEmail were DROPPED from `inspections`; this spec never
        // reads them (getRepairList works off results + template).
        propertyAddress: '1 Main St',
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
        expect(result.totals.maintenance).toBe(1);
        expect(result.totals.safety).toBe(0);
        // The repair list totals no money. It counts defects.
        expect(Object.keys(result.totals)).not.toContain('estimateLowSum');
        expect(Object.keys(result.totals)).not.toContain('estimateHighSum');
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
                        { cannedId: 'def-default-off', included: true, recommendationId: 'roof-leak' },
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
        expect(result.totals.safety).toBe(1);
    });

    /**
     * The repair list is the punch list a contractor or realtor is handed, and
     * it is served over `GET /api/inspections/{id}/repair-list` — an endpoint on
     * the MCP `extended` tier, which is ON in production. The report badge was
     * pinned off (`showEstimates = false`), but this exit never had a gate: a
     * price on a stored finding walked straight out of it.
     *
     * The fixture is written past the service on purpose, with amounts, so this
     * proves the READ drops them rather than the write never having stored them.
     */
    it('publishes no money for a stored finding that still carries estimates', async () => {
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-legacy-price',
            inspectionId: INSPECTION_ID,
            tenantId: TENANT,
            data: {
                'roof-shingles': {
                    tabs: {
                        defects: [
                            { cannedId: 'def-default-on', included: true, estimateLow: 50000, estimateHigh: 150000 },
                        ],
                    },
                    customComments: {
                        defects: [
                            { id: 'cust-1', title: 'Loose flashing', comment: 'x', included: true, category: 'safety', estimateLow: 700000, estimateHigh: 900000 },
                        ],
                    },
                },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
            lastSyncedAt: new Date(),
        });

        // The row really holds the amounts.
        const stored = await testDb.select().from(schema.inspectionResults).get();
        expect(JSON.stringify(stored!.data)).toContain('150000');
        expect(JSON.stringify(stored!.data)).toContain('900000');

        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.defects.length).toBe(2);
        for (const d of result.defects) {
            expect(Object.keys(d)).not.toContain('estimateLow');
            expect(Object.keys(d)).not.toContain('estimateHigh');
        }
        expect(Object.keys(result.totals)).not.toContain('estimateLowSum');
        expect(Object.keys(result.totals)).not.toContain('estimateHighSum');
        expect(JSON.stringify(result)).not.toContain('150000');
        expect(JSON.stringify(result)).not.toContain('900000');
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
        // IA-57 — custom defects carry no structured trade field today.
        expect(custom!.trade).toBeNull();
        expect(result.totals.safety).toBe(1);
        expect(result.totals.maintenance).toBe(1);
    });

    // IA-57 — `trade` ("who should fix this") was only ever Mustache-interpolated
    // into the comment, so it vanished whenever the canned prose lacked the
    // {{trade}} placeholder. The repair list must carry the resolved label so the
    // public repair-request page can snapshot and show it.
    it('carries the resolved trade label onto the repair-list entry', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                tabs: {
                    defects: [
                        { cannedId: 'def-default-on', included: true, trade: 'licensed-roofer' },
                    ],
                },
            },
        });
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        const shingles = result.defects.find(d => d.itemLabel === 'Shingles');
        expect(shingles).toBeDefined();
        // The label, not the slug — same resolution the report card renders.
        expect(shingles!.trade).toBe('licensed roofer');
    });

    it('leaves trade null when the inspector picked none', async () => {
        const result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.defects[0]!.trade).toBeNull();
    });

    it('reports showEstimates=false regardless of tenant_configs', async () => {
        // The repair list does not read tenant_configs itself — it forwards
        // getReportData's `showEstimates`, so it inherits the render-side pin
        // that keeps embedded estimates out of the report while they are
        // redesigned as a standalone deliverable.
        let result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.showEstimates).toBe(false);
        // Insert config with show_estimates = 1 — still false downstream.
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT, showEstimates: true, updatedAt: new Date(),
        });
        result = await svc.getRepairList(INSPECTION_ID, TENANT);
        expect(result.showEstimates).toBe(false);
    });
});
