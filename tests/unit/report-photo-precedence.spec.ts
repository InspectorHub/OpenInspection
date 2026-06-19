/**
 * Plan 4 — getReportData item-photo display precedence.
 * Resolved key must be annotatedKey || croppedKey || key; originalKey stays the
 * raw source key regardless.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// eslint-disable-next-line import/first
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000cc';
const INSPECTION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const TEMPLATE_ID = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

const TEMPLATE_SCHEMA = {
    schemaVersion: 2,
    sections: [
        { id: 'roof', title: 'Roof', items: [{ id: 'roof-shingles', label: 'Shingles', tabs: { information: [], limitations: [], defects: [] } }] },
    ],
};

describe('getReportData photo precedence (annotatedKey || croppedKey || key)', () => {
    let testDb: BetterSQLite3Database<typeof schema>;
    let svc: InspectionService;

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        svc = new InspectionService({} as D1Database);

        await testDb.insert(schema.tenants).values({
            id: TENANT, name: 'Acme', slug: 'acme-prec', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
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
        await testDb.insert(schema.inspectionResults).values({
            id: 'res-prec', tenantId: TENANT, inspectionId: INSPECTION_ID,
            data: {
                'roof-shingles': {
                    rating: 'Defect',
                    photos: [
                        { key: 'a.jpg' },
                        { key: 'b.jpg', croppedKey: 'b-crop.jpg' },
                        { key: 'c.jpg', croppedKey: 'c-crop.jpg', annotatedKey: 'c-ann.png' },
                    ],
                },
            },
            lastSyncedAt: new Date(),
        });
    });

    it('annotated wins over cropped wins over original; originalKey stays the raw key', async () => {
        const report = await svc.getReportData(INSPECTION_ID, TENANT, (k) => `/p/${k}`);
        const photos = report.sections[0]!.items[0]!.photos as Array<{ key: string; originalKey: string; url: string }>;
        expect(photos.map((p) => p.key)).toEqual(['a.jpg', 'b-crop.jpg', 'c-ann.png']);
        expect(photos.map((p) => p.originalKey)).toEqual(['a.jpg', 'b.jpg', 'c.jpg']);
        expect(photos.map((p) => p.url)).toEqual(['/p/a.jpg', '/p/b-crop.jpg', '/p/c-ann.png']);
    });
});
