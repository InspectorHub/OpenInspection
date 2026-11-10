import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { InspectionService, resolveCoverUrl } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import { MAX_PHOTO_BYTES } from '../../../server/lib/media/store-photo';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import { lazyD1 } from '../helpers/d1-binding';
const testD1 = lazyD1();
// eslint-disable-next-line import/first

const TENANT = '00000000-0000-0000-0000-0000000000cc';
const INSPECTION_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const ITEM_ID = 'item-ann-1';

function makeFakeR2() {
  const store = new Map<string, ArrayBuffer>();
  return {
    bucket: {
      put: vi.fn(async (key: string, value: ArrayBuffer) => { store.set(key, value); }),
      get: vi.fn(async (key: string) => {
        const v = store.get(key);
        return v ? { arrayBuffer: async () => v } : null;
      }),
    } as unknown as R2Bucket,
    store,
  };
}

describe('saveAnnotation', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let svc: InspectionService;
  let r2: ReturnType<typeof makeFakeR2>;

  beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    testD1.use(testDb);
    r2 = makeFakeR2();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = new ScopedDB(testDb as any, TENANT);
    svc = new InspectionService(testD1.binding, r2.bucket, sdb);

    await testDb.insert(schema.tenants).values({
      id: TENANT, slug: 'acme-ann', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
      id: INSPECTION_ID, tenantId: TENANT, templateId: null,
      propertyAddress: '1 Main St',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
      paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    // Seed inspection_results with an old-shape source key (no /photos/ prefix).
    await testDb.insert(schema.inspectionResults).values({
      id: 'res-ann-1', tenantId: TENANT, inspectionId: INSPECTION_ID,
      data: {
        [ITEM_ID]: {
          photos: [{ key: 'orig.jpg' }],
        },
      },
      lastSyncedAt: new Date(),
    });
  });

  it('refuses a rendering over the photo ceiling with 413 and stores nothing; one at the ceiling is accepted', async () => {
    await expect(svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(MAX_PHOTO_BYTES + 1), '[]', undefined))
      .rejects.toMatchObject({ status: 413 });
    expect(r2.store.size).toBe(0);
    const { annotatedKey } = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(MAX_PHOTO_BYTES), '[]', undefined);
    expect(r2.store.has(annotatedKey)).toBe(true);
  });

  it('writes the annotatedKey to R2 and records it on the photo entry', async () => {
    const { annotatedKey } = await svc.saveAnnotation(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), '[]', undefined,
    );
    expect(annotatedKey).toMatch(/\.annotated\.[0-9a-f]{8}\.png$/);
    expect(r2.store.has(annotatedKey)).toBe(true);
    const row = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const data = (typeof row!.data === 'string' ? JSON.parse(row!.data) : row!.data) as Record<string, { photos: Array<{ key: string; annotatedKey?: string; annotationsJson?: string }> }>;
    const entry = data[ITEM_ID].photos[0];
    expect(entry.annotatedKey).toBe(annotatedKey);
    expect(entry.annotationsJson).toBe('[]');
    expect(entry.key).toBe('orig.jpg');
  });

  it('#181 skipResultsWrite: bakes R2 + returns the key but leaves inspection_results.data UNTOUCHED', async () => {
    const before = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const beforeData = JSON.stringify(typeof before!.data === 'string' ? JSON.parse(before!.data) : before!.data);

    const { annotatedKey } = await svc.saveAnnotation(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), '[{"kind":"circle"}]', undefined,
      { skipResultsWrite: true },
    );

    // R2 object still written + key returned (authoritative binary).
    expect(annotatedKey).toMatch(/\.annotated\.[0-9a-f]{8}\.png$/);
    expect(r2.store.has(annotatedKey)).toBe(true);

    // results.data is byte-identical — the doc owns the metadata under collab.
    const after = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const afterData = JSON.stringify(typeof after!.data === 'string' ? JSON.parse(after!.data) : after!.data);
    expect(afterData).toBe(beforeData);
    const entry = (JSON.parse(afterData) as Record<string, { photos: Array<{ key: string; annotatedKey?: string }> }>)[ITEM_ID].photos[0];
    expect(entry.annotatedKey).toBeUndefined(); // never written
  });

  it('co-locates annotatedKey under the same mediaId as the new-convention source key', async () => {
    // Update the seeded photo to use a new-convention key so mediaIdFromKey extracts the mediaId.
    const MEDIAID = 'a1b2c3d4-0000-0000-0000-000000000002';
    const newShapeKey = `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.jpg`;
    await testDb.update(schema.inspectionResults)
      .set({
        data: {
          [ITEM_ID]: { photos: [{ key: newShapeKey }] },
        },
      })
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID));

    const { annotatedKey } = await svc.saveAnnotation(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), '[]', undefined,
    );
    expect(annotatedKey).toMatch(new RegExp(`^${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}\\.annotated\\.[0-9a-f]{8}\\.png$`));
    expect(r2.store.has(annotatedKey)).toBe(true);
  });

  it('a re-annotation gets a NEW key: the earlier file is not overwritten (caches and published reports keep it)', async () => {
    const MEDIAID = 'a1b2c3d4-0000-0000-0000-000000000003';
    const sourceKey = `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.jpg`;
    await testDb.update(schema.inspectionResults)
      .set({ data: { [ITEM_ID]: { photos: [{ key: sourceKey }] } } })
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID));

    const first = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1, 1, 1]).buffer, '[1]', undefined);
    const second = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([2, 2, 2]).buffer, '[2]', undefined);

    expect(second.annotatedKey).not.toBe(first.annotatedKey);
    // Both stay in R2 until the orphan sweep finds the old one unreferenced, and the entry names only the newest.
    expect(r2.store.has(first.annotatedKey)).toBe(true);
    expect(r2.store.has(second.annotatedKey)).toBe(true);
    const row = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const data = (typeof row!.data === 'string' ? JSON.parse(row!.data) : row!.data) as Record<string, { photos: Array<{ annotatedKey?: string }> }>;
    expect(data[ITEM_ID].photos[0].annotatedKey).toBe(second.annotatedKey);
  });

  // The cover names a photo by the key it shows. A baked file now gets a new key each time, so a cover that pointed at
  // the old file follows its photo to the new one (it used to follow by being overwritten); any other cover is left alone.
  it('a cover that pointed at the photo\'s earlier annotated file follows it to the new one', async () => {
    const MEDIAID = 'a1b2c3d4-0000-0000-0000-000000000004';
    const sourceKey = `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.jpg`;
    await testDb.update(schema.inspectionResults)
      .set({ data: { [ITEM_ID]: { photos: [{ key: sourceKey }] } } })
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID));
    const first = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1]).buffer, '[1]', undefined);
    await testDb.update(schema.inspections).set({ coverPhotoId: first.annotatedKey }).where(eq(schema.inspections.id, INSPECTION_ID));

    const second = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([2]).buffer, '[2]', undefined);

    const insp = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID)).get();
    expect(insp?.coverPhotoId).toBe(second.annotatedKey);
  });

  it('a cover that names some other photo is left alone', async () => {
    await testDb.update(schema.inspections).set({ coverPhotoId: 'someone-else.jpg' }).where(eq(schema.inspections.id, INSPECTION_ID));
    await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1]).buffer, '[1]', undefined);
    const insp = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID)).get();
    expect(insp?.coverPhotoId).toBe('someone-else.jpg');
  });

  it('the cover also follows when the results document owns the entry (skipResultsWrite)', async () => {
    await testDb.update(schema.inspections).set({ coverPhotoId: 'orig.jpg' }).where(eq(schema.inspections.id, INSPECTION_ID));
    const { annotatedKey } = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1]).buffer, '[1]', undefined, { skipResultsWrite: true });
    const insp = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID)).get();
    expect(insp?.coverPhotoId).toBe(annotatedKey);
  });

  // An annotation keeps the photo's frame, so the stored cover crop rectangle stays ("Adjust cover" reopens on it). The
  // baked cover file was cut before the strokes and is made on the client, so it cannot be redone here; the report prefers
  // it, so it is cleared and the report cover becomes the annotated photo instead of a stale image without the strokes.
  it('moving a cover to the new annotated file keeps its stored crop rectangle and clears the stale baked file', async () => {
    const rect = { aspect: '3:2' as const, orientation: 'landscape' as const, x: 5, y: 6, width: 70, height: 40 };
    await testDb.update(schema.inspections).set({ coverPhotoId: 'orig.jpg', coverCrop: rect, coverImageKey: 'baked-cover.jpg' }).where(eq(schema.inspections.id, INSPECTION_ID));
    const { annotatedKey } = await svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1]).buffer, '[1]', undefined);
    const insp = await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID)).get();
    expect(insp?.coverPhotoId).toBe(annotatedKey);
    expect(insp?.coverCrop).toEqual(rect);
    expect(insp?.coverImageKey).toBeNull();
    expect(resolveCoverUrl({ coverImageKey: insp?.coverImageKey ?? null, coverPhotoId: insp?.coverPhotoId ?? null }, (k) => k)).toBe(annotatedKey);
  });

  // Under collaborative editing the results row is written late, so two bakes of the same cover photo can arrive while it
  // still shows the first state. The cover is matched against the photo's whole family of keys, not only the key the row
  // says it shows, so the second bake still finds it.
  describe('with the results row not yet updated (collab flush delay)', () => {
    const MEDIAID = 'a1b2c3d4-0000-0000-0000-000000000005';
    const folder = () => `${TENANT}/inspections/${INSPECTION_ID}/photos/`;
    const cover = async () => (await testDb.select().from(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID)).get())?.coverPhotoId;
    beforeEach(async () => {
      await testDb.update(schema.inspectionResults)
        .set({ data: { [ITEM_ID]: { photos: [{ key: `${folder()}${MEDIAID}.jpg` }] } } })
        .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID));
    });
    const bake = () => svc.saveAnnotation(INSPECTION_ID, TENANT, ITEM_ID, 0, new Uint8Array([1]).buffer, '[1]', undefined, { skipResultsWrite: true });

    it('two quick bakes of the cover photo: the cover follows both', async () => {
      await testDb.update(schema.inspections).set({ coverPhotoId: `${folder()}${MEDIAID}.jpg` }).where(eq(schema.inspections.id, INSPECTION_ID));
      const first = await bake();
      expect(await cover()).toBe(first.annotatedKey);
      const second = await bake(); // the row still says the photo shows its original
      expect(second.annotatedKey).not.toBe(first.annotatedKey);
      expect(await cover()).toBe(second.annotatedKey);
    });

    it('a cover on ANOTHER photo is never moved, whatever its key looks like', async () => {
      for (const other of [`${folder()}OTHER.jpg`, `${folder()}OTHER.annotated.a1b2c3d4.png`, `${folder()}${MEDIAID}x.jpg`, `${TENANT}/inspections/OTHER/photos/${MEDIAID}.annotated.a1b2c3d4.png`]) {
        await testDb.update(schema.inspections).set({ coverPhotoId: other }).where(eq(schema.inspections.id, INSPECTION_ID));
        await bake();
        expect(await cover()).toBe(other);
      }
    });
  });
});
