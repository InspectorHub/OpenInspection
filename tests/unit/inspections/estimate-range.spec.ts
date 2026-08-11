/**
 * A finding carries no repair price — at the results write boundary, and again
 * at every read that used to publish one.
 *
 * The platform does not produce repair prices (see
 * scripts/check-price-capability.mjs for why). Three keys survived the removal
 * of the authoring UI and stayed writable by hand:
 *   - `tabs.defects[].estimateLow` / `estimateHigh` (per-defect range)
 *   - `estimateMin` / `estimateMax` (item level)
 * and two reads still published them: the report item's "Estimated cost" badge
 * and the repair list's `estimateLowSum` / `estimateHighSum`, the latter over
 * an API that is exposed on the MCP `extended` tier.
 *
 * Every fixture here carries a NON-ZERO amount and every test first proves the
 * amount was really in the input. An "absent from the output" assertion is
 * vacuously green against an input that never had the field, which is exactly
 * how a stripped-out capability comes back unnoticed.
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
        // #307 — the report reads the inspection's OWN frozen structure and no
        // longer falls back to the live template, so the fixture has to freeze
        // one, exactly as every real creation path does.
        templateSnapshot: TEMPLATE_SCHEMA,
        propertyAddress: '1 Main St',
        date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
        paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
}

describe('repair estimates are neither stored nor published', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    /**
     * Write `inspection_results.data` straight to D1, past the service.
     *
     * The read-side guarantees have to hold for rows that ALREADY contain a
     * price — every finding written before the capability was withdrawn. Going
     * through updateResults would let the write-side strip do the read-side's
     * work, and the read tests would pass with no reader change at all.
     */
    async function seedRawResults(data: Record<string, unknown>) {
        await testDb.insert(schema.inspectionResults).values({
            id: crypto.randomUUID(),
            inspectionId: INSPECTION_ID,
            tenantId: TENANT,
            data,
            lastSyncedAt: new Date(),
        });
        const row = await testDb.select().from(schema.inspectionResults).get();
        // The row really holds the money we are about to assert is unpublished.
        expect(JSON.stringify(row!.data)).toMatch(/\d{4,}/);
    }

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);
        await seedFixture(testDb);
    });

    // ── Write boundary ───────────────────────────────────────────────────────

    it('updateResults refuses to store a per-defect estimate range', async () => {
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
        const keys = Object.keys(defects[0]!);
        expect(keys).not.toContain('estimateLow');
        expect(keys).not.toContain('estimateHigh');
        // The rest of the defect row is untouched — the price is dropped, not
        // the write.
        expect(defects[0]!.recommendationId).toBe('roof-leak');
        expect(defects[0]!.included).toBe(true);
    });

    it('updateResults refuses to store an item-level estimate', async () => {
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': {
                rating: 'Defect',
                notes: 'two tabs lifted',
                estimateMin: 250000,
                estimateMax: 900000,
            },
        });

        const row = await testDb.select().from(schema.inspectionResults).get();
        const entry = (row!.data as Record<string, Record<string, unknown>>)['roof-shingles']!;
        expect(Object.keys(entry)).not.toContain('estimateMin');
        expect(Object.keys(entry)).not.toContain('estimateMax');
        expect(entry.rating).toBe('Defect');
        expect(entry.notes).toBe('two tabs lifted');
    });

    it('updateResults still drops unknown recommendation slugs', async () => {
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

    // ── Read boundary — a row that already holds a price ─────────────────────

    it('getReportData publishes no estimate on an item whose defects carry one', async () => {
        await seedRawResults({
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
        expect(Object.keys(item)).not.toContain('estimateMin');
        expect(Object.keys(item)).not.toContain('estimateMax');

        // …and not on the resolved defect rows the renderers walk either.
        const defects = item.resolvedTabs!.defects!;
        expect(defects.length).toBeGreaterThan(0);
        for (const d of defects) {
            expect(Object.keys(d)).not.toContain('estimateLow');
            expect(Object.keys(d)).not.toContain('estimateHigh');
        }
    });

    it('getReportData publishes no estimate on an item that stores one directly', async () => {
        await seedRawResults({
            'roof-shingles': { rating: 'Defect', estimateMin: 250000, estimateMax: 900000 },
        });

        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        const item = report.sections[0]!.items[0]!;
        expect(Object.keys(item)).not.toContain('estimateMin');
        expect(Object.keys(item)).not.toContain('estimateMax');
        expect(item.rating).toBe('Defect');
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

    it('getReportData forces showEstimates=false even when tenant_configs.show_estimates=1', async () => {
        // A tenant that opted in before embedded estimates were withdrawn. The
        // stored intent is deliberately left intact (the column is still there
        // and still readable); what must not happen is the report rendering it.
        await testDb.insert(schema.tenantConfigs).values({
            tenantId: TENANT,
            showEstimates: true,
            updatedAt: new Date(),
        });
        await svc.updateResults(INSPECTION_ID, TENANT, {
            'roof-shingles': { rating: 'Satisfactory' },
        });

        const report = await svc.getReportData(INSPECTION_ID, TENANT);
        expect(report.showEstimates).toBe(false);

        // The two numbers that must disagree: what the tenant asked for vs what
        // the renderer is handed. Printing both makes the guard's job visible —
        // if the stored value ever reads false the assertion above would pass
        // for the wrong reason (nothing was pinned; there was nothing to pin).
        const stored = await testDb
            .select({ v: schema.tenantConfigs.showEstimates })
            .from(schema.tenantConfigs)
            .where(eq(schema.tenantConfigs.tenantId, TENANT))
            .get();
        expect(stored?.v).toBe(true);
        expect(report.showEstimates).not.toBe(stored?.v);
    });
});
