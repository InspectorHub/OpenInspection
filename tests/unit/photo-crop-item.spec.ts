import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { PhotoCropSchema } from '../../server/lib/validations/inspection.schema';
import { InspectionService } from '../../server/services/inspection.service';
import { createTestDb, setupSchema } from './db';
import * as schema from '../../server/lib/db/schema';
import { ScopedDB } from '../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

describe('PhotoCropSchema', () => {
  const base = { orientation: 'landscape', x: 0, y: 0, width: 1200, height: 800 };
  it('accepts a preset aspect', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: '3:2' }).success).toBe(true);
  });
  it('accepts free aspect (item/defect photos are not constrained like covers)', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free' }).success).toBe(true);
  });
  it('rejects non-positive dims', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free', width: 0 }).success).toBe(false);
  });
  it('rejects negative origin', () => {
    expect(PhotoCropSchema.safeParse({ ...base, aspect: 'free', x: -1 }).success).toBe(false);
  });
});

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// eslint-disable-next-line import/first
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000bb';
const INSPECTION_ID = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const ITEM_ID = 'item-1';
const CROP = { aspect: 'free', orientation: 'landscape', x: 0, y: 0, width: 100, height: 80 } as const;

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

interface CropEntry { key: string; croppedKey?: string; crop?: unknown; annotatedKey?: string; annotationsJson?: string }

describe('saveCroppedItemPhoto', () => {
  let testDb: BetterSQLite3Database<typeof schema>;
  let svc: InspectionService;
  let r2: ReturnType<typeof makeFakeR2>;

  beforeEach(async () => {
    const fixture = createTestDb();
    testDb = fixture.db;
    await setupSchema(fixture.sqlite);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    r2 = makeFakeR2();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = new ScopedDB(testDb as any, TENANT);
    svc = new InspectionService({} as D1Database, r2.bucket, sdb);

    await testDb.insert(schema.tenants).values({
      id: TENANT, name: 'Acme', slug: 'acme-crop', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
      id: INSPECTION_ID, tenantId: TENANT, templateId: null,
      propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
      paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    // Seed an inspection_results row whose item photo[0] is already annotated.
    await testDb.insert(schema.inspectionResults).values({
      id: 'res-1', tenantId: TENANT, inspectionId: INSPECTION_ID,
      data: {
        [ITEM_ID]: {
          photos: [
            { key: 'orig.jpg', annotatedKey: 'old-ann.png', annotationsJson: '[{"kind":"circle"}]' },
          ],
        },
      },
      lastSyncedAt: new Date(),
    });
  });

  async function readEntry(idx: number): Promise<CropEntry> {
    const row = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const data = (typeof row!.data === 'string' ? JSON.parse(row!.data) : row!.data) as Record<string, { photos: CropEntry[] }>;
    return data[ITEM_ID].photos[idx];
  }

  it('bakes a croppedKey onto the targeted photo entry and CLEARS prior annotation (recrop)', async () => {
    const { croppedKey } = await svc.saveCroppedItemPhoto(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), CROP, undefined,
    );
    expect(croppedKey).toMatch(/\.cropped\.jpg$/);
    expect(r2.store.has(croppedKey)).toBe(true);
    const entry = await readEntry(0);
    expect(entry.croppedKey).toBe(croppedKey);
    expect(entry.crop).toMatchObject({ aspect: 'free', width: 100 });
    expect(entry.annotatedKey).toBeUndefined();   // cleared by re-crop
    expect(entry.annotationsJson).toBeUndefined();
    expect(entry.key).toBe('orig.jpg');           // original preserved
  });

  it('#181 skipResultsWrite: bakes R2 + returns croppedKey but leaves inspection_results.data UNTOUCHED', async () => {
    const before = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const beforeData = JSON.stringify(typeof before!.data === 'string' ? JSON.parse(before!.data) : before!.data);

    const { croppedKey } = await svc.saveCroppedItemPhoto(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), CROP, undefined,
      { skipResultsWrite: true },
    );

    // R2 object still written + key returned (authoritative binary).
    expect(croppedKey).toMatch(/\.cropped\.jpg$/);
    expect(r2.store.has(croppedKey)).toBe(true);

    // results.data is byte-identical — the seeded annotation is NOT cleared
    // server-side (the client mirrors the sequential-layering drop into the doc).
    const after = await testDb.select().from(schema.inspectionResults)
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID)).get();
    const afterData = JSON.stringify(typeof after!.data === 'string' ? JSON.parse(after!.data) : after!.data);
    expect(afterData).toBe(beforeData);
    const entry = (JSON.parse(afterData) as Record<string, { photos: CropEntry[] }>)[ITEM_ID].photos[0];
    expect(entry.croppedKey).toBeUndefined();        // never written
    expect(entry.annotatedKey).toBe('old-ann.png');  // untouched (still present)
  });

  it('throws NotFound when photoIndex is out of range', async () => {
    await expect(svc.saveCroppedItemPhoto(INSPECTION_ID, TENANT, ITEM_ID, 99, new ArrayBuffer(8), CROP, undefined))
      .rejects.toThrow(/Photo not found/);
  });

  it('co-locates croppedKey under the same mediaId as the new-convention source key', async () => {
    // Seed a photo with a new-convention key so mediaIdFromKey can extract the mediaId.
    const MEDIAID = 'a1b2c3d4-0000-0000-0000-000000000001';
    const newShapeKey = `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.jpg`;
    await testDb.update(schema.inspectionResults)
      .set({
        data: {
          [ITEM_ID]: { photos: [{ key: newShapeKey }] },
        },
      })
      .where(eq(schema.inspectionResults.inspectionId, INSPECTION_ID));

    const { croppedKey } = await svc.saveCroppedItemPhoto(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), CROP, undefined,
    );
    expect(croppedKey).toBe(
      `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.cropped.jpg`,
    );
    expect(r2.store.has(croppedKey)).toBe(true);
  });
});
