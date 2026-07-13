import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InspectionService } from '../../../server/services/inspection.service';
import { ScopedDB, type DrizzleDB } from '../../../server/lib/db/scoped';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-000000000099';
const INSPECTION_ID = '11111111-1111-1111-1111-111111111111';

/**
 * Round-2 backlog #9 (Spectora §E.3) — Media Center service-level tests.
 *
 * Coverage:
 *   - getMediaCenter aggregates attached photos with section/item labels
 *   - getMediaCenter returns the loose pool sorted newest first
 *   - attachPoolPhoto moves a row from pool to results.data and removes it
 *     from the pool atomically (verified by re-running getMediaCenter)
 *   - deletePoolPhoto removes the pool row and (when r2 binding exists)
 *     deletes the underlying object
 *   - tenant isolation — a pool row owned by a different tenant is invisible
 */
// The 5 sdb-backed cases need a ScopedDB wired over the test db (the methods
// run through this.photo → ScopedDB, provided in production via DI). We build
// one over the same better-sqlite3 fixture the drizzle mock returns.
describe('InspectionService — Media Center (Round-2 backlog #9)', () => {
    let svc: InspectionService;
    let testDb: BetterSQLite3Database<typeof schema>;
    const r2Mock = {
        put:    vi.fn().mockResolvedValue(undefined),
        delete: vi.fn().mockResolvedValue(undefined),
    };

    beforeEach(async () => {
        const fixture = createTestDb();
        testDb = fixture.db;
        await setupSchema(fixture.sqlite);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (mockDrizzle as any).mockReturnValue(testDb);
        // Wire a ScopedDB over the same fixture db so this.photo's tenant-scoped
        // reads/writes resolve (mirrors the DI-provided sdb in production).
        const sdb = new ScopedDB(testDb as unknown as DrizzleDB, TENANT);
        // Cast r2Mock to the R2Bucket shape we use (put/delete only).
        svc = new InspectionService({} as D1Database, r2Mock as unknown as R2Bucket, sdb);
        r2Mock.put.mockClear();
        r2Mock.delete.mockClear();

        await testDb.insert(schema.tenants).values([
            { id: TENANT, name: 'Acme', slug: 'acme', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date() },
        ]);

        // Inspection with a frozen template snapshot so getMediaCenter can
        // resolve item label + section title without a templates row.
        const snapshot = {
            schemaVersion: 2,
            sections: [
                {
                    id: 'sec-roof', title: 'Roof', items: [
                        { id: 'item-cover', label: 'Roof Covering' },
                        { id: 'item-flash', label: 'Flashing' },
                    ],
                },
                {
                    id: 'sec-elec', title: 'Electrical', items: [
                        { id: 'item-panel', label: 'Service Panel' },
                    ],
                },
            ],
        };
        await testDb.insert(schema.inspections).values([{
            id:               INSPECTION_ID,
            tenantId:         TENANT,
            propertyAddress:  '1 Main St',
            clientName:       'Test Client',
            clientEmail:      'c@example.com',
            date:             '2026-06-01',
            status:           'in_progress',
            paymentStatus:    'unpaid',
            price:            0,
            paymentRequired:  false,
            agreementRequired: false,
            createdAt:        new Date(),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            templateSnapshot: snapshot as any,
        }]);
    });

    it('getMediaCenter returns empty arrays for an inspection with no photos', async () => {
        const out = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(out.attached).toEqual([]);
        expect(out.pool).toEqual([]);
    });

    it('getMediaCenter aggregates attached photos with section/item labels', async () => {
        await testDb.insert(schema.inspectionResults).values({
            id:            'res-1',
            tenantId:      TENANT,
            inspectionId:  INSPECTION_ID,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data:          {
                'item-cover': {
                    photos: [
                        { key: 'k-cover-1' },
                        { key: 'k-cover-2', annotatedKey: 'k-cover-2-annot' },
                    ],
                },
                'item-panel': { photos: [{ key: 'k-panel-1' }] },
            } as any,
            lastSyncedAt:  new Date(),
        });

        const out = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(out.attached).toHaveLength(3);

        const cover1 = out.attached.find(p => p.key === 'k-cover-1');
        expect(cover1).toMatchObject({
            itemId:       'item-cover',
            itemLabel:    'Roof Covering',
            sectionId:    'sec-roof',
            sectionTitle: 'Roof',
            photoIndex:   0,
            annotated:    false,
        });
        expect(cover1!.url).toContain('/photo?key=k-cover-1');

        // The annotated copy is preferred for display, the photoIndex still
        // points at index 1 of the photos array (so the editor can resolve
        // it back to the original entry).
        const cover2 = out.attached.find(p => p.key === 'k-cover-2-annot');
        expect(cover2).toMatchObject({ photoIndex: 1, annotated: true });

        // Panel item lives in a different section.
        const panel = out.attached.find(p => p.key === 'k-panel-1');
        expect(panel?.sectionTitle).toBe('Electrical');
    });

    it('uploadPoolPhoto persists a row + getMediaCenter returns it (newest first)', async () => {
        const file1 = new File([new Uint8Array([1, 2, 3])], 'a.jpg', { type: 'image/jpeg' });
        const file2 = new File([new Uint8Array([4, 5, 6])], 'b.jpg', { type: 'image/jpeg' });

        const a = await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, file1, { takenAt: 1700000000000 });
        // Stagger so uploadedAt orders deterministically.
        await new Promise(r => setTimeout(r, 5));
        const b = await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, file2);

        expect(r2Mock.put).toHaveBeenCalledTimes(2);
        expect(a.takenAt).toBe(1700000000000);
        expect(b.takenAt).toBeNull();

        const out = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(out.pool.map(p => p.id)).toEqual([b.id, a.id]); // newest first
        expect(out.pool[0]?.url).toContain('/photo?key=');
    });

    it('attachPoolPhoto moves a pool row into results.data and removes the pool entry', async () => {
        const file = new File([new Uint8Array([1])], 'p.jpg', { type: 'image/jpeg' });
        const pool = await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, file);

        const result = await svc.attachPoolPhoto(INSPECTION_ID, TENANT, pool.id, 'item-flash');
        expect(result).toMatchObject({ key: pool.key, itemId: 'item-flash', photoIndex: 0 });

        const after = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(after.pool).toHaveLength(0);
        expect(after.attached).toHaveLength(1);
        expect(after.attached[0]).toMatchObject({
            key:       pool.key,
            itemId:    'item-flash',
            itemLabel: 'Flashing',
        });
    });

    it('attachPoolPhoto appends to an existing photos array (preserves prior shots)', async () => {
        await testDb.insert(schema.inspectionResults).values({
            id:            'res-existing',
            tenantId:      TENANT,
            inspectionId:  INSPECTION_ID,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            data:          { 'item-cover': { photos: [{ key: 'pre-existing' }] } } as any,
            lastSyncedAt:  new Date(),
        });
        const pool = await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, new File([new Uint8Array([2])], 'q.jpg', { type: 'image/jpeg' }));

        const out = await svc.attachPoolPhoto(INSPECTION_ID, TENANT, pool.id, 'item-cover');
        expect(out.photoIndex).toBe(1);

        const after = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(after.attached.filter(p => p.itemId === 'item-cover')).toHaveLength(2);
    });

    it('deletePoolPhoto removes the row and calls r2.delete', async () => {
        const pool = await svc.uploadPoolPhoto(INSPECTION_ID, TENANT, new File([new Uint8Array([3])], 'r.jpg', { type: 'image/jpeg' }));
        await svc.deletePoolPhoto(INSPECTION_ID, TENANT, pool.id);
        const after = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(after.pool).toHaveLength(0);
        expect(r2Mock.delete).toHaveBeenCalledWith(pool.key);
    });

    it('tenant isolation — pool rows for another tenant are invisible to attach/list/delete', async () => {
        // Seed a pool row that belongs to a *different* tenant + inspection.
        await testDb.insert(schema.inspectionMediaPool).values({
            id:           'foreign-pool',
            inspectionId: INSPECTION_ID, // same inspection id
            tenantId:     '99999999-9999-9999-9999-999999999999',
            r2Key:        'evil-key',
            url:          '/api/inspections/x/photos/evil-key',
            uploadedAt:   new Date(),
        });

        const out = await svc.getMediaCenter(INSPECTION_ID, TENANT);
        expect(out.pool.find(p => p.id === 'foreign-pool')).toBeUndefined();

        await expect(svc.attachPoolPhoto(INSPECTION_ID, TENANT, 'foreign-pool', 'item-cover'))
            .rejects.toThrow(/not found/i);
    });
});
