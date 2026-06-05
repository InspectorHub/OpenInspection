/**
 * DB-6 — cover-photo dangling reference regression test.
 *
 * Scenario:
 *   1. Inspector uploads a photo to the pool.
 *   2. Inspector marks it as the report cover (inspections.cover_photo_id = pool row id).
 *   3. Inspector drags it onto an inspection item (attachPoolPhoto).
 *
 * Before the fix, attachPoolPhoto deleted the pool row unconditionally, leaving
 * coverPhotoId pointing at a non-existent row (dangling FK). The preflight gate
 * then reads coverPhotoId != null → "cover set", but the row is gone and any
 * renderer resolving the R2 key via the pool table would find nothing.
 *
 * After the fix, the pool row is preserved when it is the current cover so that
 * coverPhotoId remains a valid reference.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { ScopedDB } from '../../server/lib/db/scoped';
import { eq, and } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT      = '00000000-0000-0000-0000-000000000099';
const INSP_ID     = '11111111-1111-1111-1111-111111111111';
const POOL_ID     = 'pool-aaa-bbb-ccc-ddd-eee';
const R2_KEY      = `${TENANT}/${INSP_ID}/_pool_${POOL_ID}_cover.jpg`;
const ITEM_ID     = 'item-exterior-doors';

let testDb: BetterSQLite3Database<typeof schema>;
let svc: InspectionService;

const r2Mock = {
    put:    vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
};

beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);

    // Wire the d1 mock so getDrizzle() resolves to the in-memory SQLite db.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);

    // Build a ScopedDB from the same in-memory db so getInspection() works.
    const sdb = new ScopedDB(testDb as never, TENANT);

    svc = new InspectionService({} as D1Database, r2Mock as unknown as R2Bucket, sdb);

    r2Mock.put.mockClear();
    r2Mock.delete.mockClear();

    // Seed tenant.
    await testDb.insert(schema.tenants).values({
        id: TENANT, name: 'Acme', slug: 'acme', status: 'active',
        deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });

    // Seed inspection with coverPhotoId pointing at the pool row.
    await testDb.insert(schema.inspections).values({
        id:               INSP_ID,
        tenantId:         TENANT,
        propertyAddress:  '1 Main St',
        clientName:       'Test Client',
        clientEmail:      'client@example.com',
        date:             '2026-06-01',
        status:           'in_progress',
        paymentStatus:    'unpaid',
        price:            0,
        paymentRequired:  false,
        agreementRequired: false,
        createdAt:        new Date(),
        // The cover is already set to the pool row we are about to attach.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        coverPhotoId:     POOL_ID as any,
    });

    // Seed the pool row (simulates a completed uploadPoolPhoto).
    await testDb.insert(schema.inspectionMediaPool).values({
        id:           POOL_ID,
        inspectionId: INSP_ID,
        tenantId:     TENANT,
        r2Key:        R2_KEY,
        url:          `/api/inspections/${INSP_ID}/photo?key=${encodeURIComponent(R2_KEY)}`,
        uploadedAt:   Date.now(),
    });
});

describe('DB-6 — attachPoolPhoto cover-photo dangle', () => {
    it('pool row survives when it is the report cover (strategy A)', async () => {
        // Act: attach the pool photo to an item.
        const result = await svc.attachPoolPhoto(INSP_ID, TENANT, POOL_ID, ITEM_ID);

        // The call must succeed and report the correct key + item.
        expect(result).toMatchObject({ key: R2_KEY, itemId: ITEM_ID, photoIndex: 0 });

        // The pool row MUST still exist — coverPhotoId must remain a valid reference.
        const poolRow = await testDb
            .select()
            .from(schema.inspectionMediaPool)
            .where(and(
                eq(schema.inspectionMediaPool.id, POOL_ID),
                eq(schema.inspectionMediaPool.tenantId, TENANT),
            ))
            .get();
        expect(poolRow).not.toBeNull();
        expect(poolRow?.r2Key).toBe(R2_KEY);
    });

    it('the photo key is still written to results.data for the item', async () => {
        await svc.attachPoolPhoto(INSP_ID, TENANT, POOL_ID, ITEM_ID);

        const resultsRow = await testDb
            .select()
            .from(schema.inspectionResults)
            .where(and(
                eq(schema.inspectionResults.inspectionId, INSP_ID),
                eq(schema.inspectionResults.tenantId, TENANT),
            ))
            .get();

        expect(resultsRow).not.toBeNull();
        const data = resultsRow!.data as Record<string, { photos?: Array<{ key: string }> }>;
        const entry = data[ITEM_ID] ?? Object.values(data).find(e => e.photos?.some(p => p.key === R2_KEY));
        expect(entry?.photos?.some(p => p.key === R2_KEY)).toBe(true);
    });

    it('pool row IS deleted when it is NOT the cover', async () => {
        const OTHER_POOL_ID  = 'pool-non-cover-row';
        const OTHER_R2_KEY   = `${TENANT}/${INSP_ID}/_pool_${OTHER_POOL_ID}_other.jpg`;

        // Insert a second pool row that is NOT the cover.
        await testDb.insert(schema.inspectionMediaPool).values({
            id:           OTHER_POOL_ID,
            inspectionId: INSP_ID,
            tenantId:     TENANT,
            r2Key:        OTHER_R2_KEY,
            url:          `/api/inspections/${INSP_ID}/photo?key=${encodeURIComponent(OTHER_R2_KEY)}`,
            uploadedAt:   Date.now(),
        });

        await svc.attachPoolPhoto(INSP_ID, TENANT, OTHER_POOL_ID, ITEM_ID);

        const gone = await testDb
            .select()
            .from(schema.inspectionMediaPool)
            .where(and(
                eq(schema.inspectionMediaPool.id, OTHER_POOL_ID),
                eq(schema.inspectionMediaPool.tenantId, TENANT),
            ))
            .get();
        expect(gone).toBeUndefined();
    });
});

describe('DB-6 — deletePoolPhoto cover-photo dangle (symmetric guard)', () => {
    it('deletePoolPhoto rejects when the pool row is the report cover', async () => {
        // POOL_ID is the cover (seeded in beforeEach with coverPhotoId = POOL_ID).
        await expect(
            svc.deletePoolPhoto(INSP_ID, TENANT, POOL_ID),
        ).rejects.toMatchObject({
            message: expect.stringContaining('report cover'),
        });

        // The pool row must still exist — the R2 object must NOT have been deleted.
        const stillThere = await testDb
            .select()
            .from(schema.inspectionMediaPool)
            .where(and(
                eq(schema.inspectionMediaPool.id, POOL_ID),
                eq(schema.inspectionMediaPool.tenantId, TENANT),
            ))
            .get();
        expect(stillThere).not.toBeUndefined();
        expect(r2Mock.delete).not.toHaveBeenCalled();
    });

    it('deletePoolPhoto succeeds and removes the R2 object when the row is NOT the cover', async () => {
        const NON_COVER_POOL_ID = 'pool-delete-non-cover';
        const NON_COVER_R2_KEY  = `${TENANT}/${INSP_ID}/_pool_${NON_COVER_POOL_ID}_nc.jpg`;

        // Insert a second pool row that is NOT the cover.
        await testDb.insert(schema.inspectionMediaPool).values({
            id:           NON_COVER_POOL_ID,
            inspectionId: INSP_ID,
            tenantId:     TENANT,
            r2Key:        NON_COVER_R2_KEY,
            url:          `/api/inspections/${INSP_ID}/photo?key=${encodeURIComponent(NON_COVER_R2_KEY)}`,
            uploadedAt:   Date.now(),
        });

        await svc.deletePoolPhoto(INSP_ID, TENANT, NON_COVER_POOL_ID);

        // DB row gone.
        const gone = await testDb
            .select()
            .from(schema.inspectionMediaPool)
            .where(and(
                eq(schema.inspectionMediaPool.id, NON_COVER_POOL_ID),
                eq(schema.inspectionMediaPool.tenantId, TENANT),
            ))
            .get();
        expect(gone).toBeUndefined();

        // R2 delete was called with the correct key.
        expect(r2Mock.delete).toHaveBeenCalledWith(NON_COVER_R2_KEY);
    });
});
