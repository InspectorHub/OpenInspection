import { describe, it, expect } from 'vitest';
import { resolveCoverUrl } from '../../../server/services/inspection.service';
describe('resolveCoverUrl', () => {
  const make = (k: string) => `/api/photo/${k}`;
  it('prefers the baked cover_image_key when present', () => {
    expect(resolveCoverUrl({ coverImageKey: 'baked.jpg', coverPhotoId: 'src.jpg' }, make)).toBe('/api/photo/baked.jpg');
  });
  it('falls back to cover_photo_id', () => {
    expect(resolveCoverUrl({ coverImageKey: null, coverPhotoId: 'src.jpg' }, make)).toBe('/api/photo/src.jpg');
  });
  it('null when neither set', () => {
    expect(resolveCoverUrl({ coverImageKey: null, coverPhotoId: null }, make)).toBeNull();
  });
});

import { CoverCropSchema } from '../../../server/lib/validations/inspection.schema';
describe('CoverCropSchema', () => {
  const valid = { aspect: '3:2', orientation: 'landscape', x: 0, y: 0, width: 1200, height: 800 };
  it('accepts valid', () => { expect(CoverCropSchema.safeParse(valid).success).toBe(true); });
  it('rejects unknown aspect', () => { expect(CoverCropSchema.safeParse({ ...valid, aspect: '5:4' }).success).toBe(false); });
  it('rejects non-positive dims', () => { expect(CoverCropSchema.safeParse({ ...valid, width: 0 }).success).toBe(false); });
});

import { beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

const TENANT = '00000000-0000-0000-0000-0000000000aa';
const INSPECTION_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const POOL_KEY = `${TENANT}/${INSPECTION_ID}/pool_photo.jpg`;
const CROP = { aspect: '3:2', orientation: 'landscape', x: 0, y: 0, width: 1200, height: 800 } as const;

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

describe('InspectionService.setCroppedCover', () => {
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
      id: TENANT, name: 'Acme', slug: 'acme-cover', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
      id: INSPECTION_ID, tenantId: TENANT, templateId: null,
      propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
      date: '2026-06-01', status: 'requested', paymentStatus: 'unpaid', price: 0,
      paymentRequired: false, agreementRequired: false, createdAt: new Date(),
    });
    await testDb.insert(schema.inspectionMediaPool).values({
      id: 'pool-1', inspectionId: INSPECTION_ID, tenantId: TENANT,
      r2Key: POOL_KEY, url: `/api/photo/${POOL_KEY}`, uploadedAt: Date.now(),
    });
  });

  it('bakes the derivative to R2 and records crop transform on the row', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer; // JPEG SOI marker
    const { coverImageKey } = await svc.setCroppedCover(INSPECTION_ID, TENANT, POOL_KEY, bytes, CROP);

    expect(coverImageKey).toMatch(new RegExp(`^${TENANT}/inspections/${INSPECTION_ID}/cover/[^/]+\\.jpg$`));
    expect(r2.store.has(coverImageKey)).toBe(true);
    expect(r2.store.get(coverImageKey)).toBe(bytes);

    const row = await testDb.select().from(schema.inspections)
      .where(eq(schema.inspections.id, INSPECTION_ID)).get();
    expect(row!.coverImageKey).toBe(coverImageKey);
    expect(row!.coverPhotoId).toBe(POOL_KEY);
    expect(row!.coverCrop).toEqual(CROP);
  });

  it('rejects a sourceKey that does not belong to the inspection', async () => {
    const bytes = new Uint8Array([0xff, 0xd8]).buffer;
    await expect(
      svc.setCroppedCover(INSPECTION_ID, TENANT, 'someone-elses/photo.jpg', bytes, CROP),
    ).rejects.toThrow();
  });
});
