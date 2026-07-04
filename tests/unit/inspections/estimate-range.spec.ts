/**
 * Sprint 2 S2-4 — Repair estimate range invariants.
 *
 * Covers:
 *   - sanitizeDefectStates (via the public updateResults boundary):
 *       drops unknown recommendation slugs, clamps negative cents to null,
 *       coerces non-finite numbers to null, accepts the legal happy path.
 *   - getReportData aggregates defects[].estimateLow / estimateHigh into
 *       item-level estimateMin / estimateMax when the legacy top-level
 *       fields are absent.
 *   - getReportData reflects the per-tenant `showEstimates` toggle stored
 *       in tenant_configs.
 *   - getReportData resolves recommendation slugs to human-readable labels.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION_ID = '11111111-1111-1111-1111-111111111111';
const TEMPLATE_ID = '22222222-2222-2222-2222-222222222222';

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
                    tabs: {
                        information: [],
                        limitations: [],
                        defects: [
                            { id: 'def-1', title: 'Missing shingles', category: 'maintenance', location: '', comment: 'Replace missing shingles.', photos: [], default: false },
                            { id: 'def-2', title: 'Active leak',      category: 'safety',      location: '', comment: 'Address the active leak.', photos: [], default: false },
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
        id: TEMPLATE_ID, tenantId: TENANT, name: 'Standard', schema: TEMPLATE_SCHEMA, version: 1, createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
        id: INSPECTION_ID, tenantId: TENANT, templateId: TEMPLATE_ID,
        propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('Sprint 2 S2-4 — repair estimate range', () => {
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

    it('sanitizeDefectStates accepts the happy-path defect payload', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                rating: 'Defect',
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, recommendationId: 'roof-leak', estimateLow: 50000, estimateHigh: 150000 },
                    ],
                },
            },
        });

        const row = await testDb.select().from(schema.inspectionResults).get();
        const data = row!.data as Record<string, unknown>;
        const defects = ((data['roof-shingles'] as { tabs: { defects: Array<Record<string, unknown>> } }).tabs.defects);
        expect(defects[0]!.recommendationId).toBe('roof-leak');
        expect(defects[0]!.estimateLow).toBe(50000);
        expect(defects[0]!.estimateHigh).toBe(150000);
    });

    it('sanitizeDefectStates drops unknown recommendation slugs', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, recommendationId: 'totally-fake-slug-xyz' },
                    ],
                },
            },
        });

        const row = await testDb.select().from(schema.inspectionResults).get();
        const data = row!.data as Record<string, unknown>;
        const defects = ((data['roof-shingles'] as { tabs: { defects: Array<Record<string, unknown>> } }).tabs.defects);
        expect(defects[0]!.recommendationId).toBeNull();
    });

    it('sanitizeDefectStates clamps negative + non-finite cents to null', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, estimateLow: -1, estimateHigh: Number.POSITIVE_INFINITY },
                    ],
                },
            },
        });

        const row = await testDb.select().from(schema.inspectionResults).get();
        const data = row!.data as Record<string, unknown>;
        const defects = ((data['roof-shingles'] as { tabs: { defects: Array<Record<string, unknown>> } }).tabs.defects);
        expect(defects[0]!.estimateLow).toBeNull();
        expect(defects[0]!.estimateHigh).toBeNull();
    });

    it('getReportData aggregates defects[].estimateLow/High to item level', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                rating: 'Defect',
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, estimateLow: 50000,  estimateHigh: 150000 },
                        { cannedId: 'def-2', included: true, estimateLow: 200000, estimateHigh: 400000 },
                    ],
                },
            },
        });

        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        const item = report.sections[0]!.items[0]!;
        // Lowest low + highest high, both expressed in dollars on the
        // report item (cents → dollars conversion happens in service).
        expect(item.estimateMin).toBe(500);
        expect(item.estimateMax).toBe(4000);
    });

    it('getReportData ignores excluded defects when aggregating', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                rating: 'Defect',
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true,  estimateLow: 50000,  estimateHigh: 150000 },
                        { cannedId: 'def-2', included: false, estimateLow: 999900, estimateHigh: 999900 },
                    ],
                },
            },
        });

        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        const item = report.sections[0]!.items[0]!;
        expect(item.estimateMin).toBe(500);
        expect(item.estimateMax).toBe(1500);
    });

    it('getReportData resolves recommendation slug to its label', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                rating: 'Defect',
                tabs: {
                    defects: [
                        { cannedId: 'def-1', included: true, recommendationId: 'roof-leak' },
                    ],
                },
            },
        });

        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        const item = report.sections[0]!.items[0]!;
        expect(item.recommendation).toMatch(/Roofing/i);
        expect(item.recommendation).toMatch(/leak/i);
    });

    it('getReportData surfaces showEstimates=false by default', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': { rating: 'Satisfactory' },
        });
        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        expect(report.showEstimates).toBe(false);
    });

    it('getReportData returns coverPhotoUrl=null when no cover is set', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, { 'roof-shingles': { rating: 'Satisfactory' } });
        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        expect(report.coverPhotoUrl).toBeNull();
    });

    it('getReportData resolves coverPhotoUrl via makePhotoUrl when cover_photo_id is set', async () => {
        const COVER_KEY = 'tenants/t/insp/item_cover.jpg';
        await testDb.update(schema.inspections)
            .set({ coverPhotoId: COVER_KEY })
            .where(eq(schema.inspections.id, INSPECTION_ID));
        const report = await svc.getReportData(
            INSPECTION_ID, TENANT,
            (key) => `https://cdn.example/${key}`,
        );
        expect(report.coverPhotoUrl).toBe(`https://cdn.example/${COVER_KEY}`);
    });

    it('getReportData reflects tenant_configs.show_estimates=true', async () => {
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            showEstimates: true,
            updatedAt: new Date(),
        });
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': { rating: 'Satisfactory' },
        });
        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        expect(report.showEstimates).toBe(true);
    });
});
