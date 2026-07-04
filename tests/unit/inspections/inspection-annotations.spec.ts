import { describe, it, expect, beforeEach, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { InspectionService } from '../../../server/services/inspection.service';
import { createTestDb, setupSchema } from '../db';
import * as schema from '../../../server/lib/db/schema';
import { ScopedDB } from '../../../server/lib/db/scoped';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
// eslint-disable-next-line import/first
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';

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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (mockDrizzle as any).mockReturnValue(testDb);
    r2 = makeFakeR2();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sdb = new ScopedDB(testDb as any, TENANT);
    svc = new InspectionService({} as D1Database, r2.bucket, sdb);

    await testDb.insert(schema.tenants).values({
      id: TENANT, name: 'Acme', slug: 'acme-ann', status: 'active', deploymentMode: 'shared', tier: 'free', createdAt: new Date(),
    });
    await testDb.insert(schema.inspections).values({
      id: INSPECTION_ID, tenantId: TENANT, templateId: null,
      propertyAddress: '1 Main St', clientName: 'C', clientEmail: 'c@example.com',
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

  it('writes the annotatedKey to R2 and records it on the photo entry', async () => {
    const { annotatedKey } = await svc.saveAnnotation(
      INSPECTION_ID, TENANT, ITEM_ID, 0, new ArrayBuffer(8), '[]', undefined,
    );
    expect(annotatedKey).toMatch(/\.annotated\.png$/);
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
    expect(annotatedKey).toMatch(/\.annotated\.png$/);
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
    expect(annotatedKey).toBe(
      `${TENANT}/inspections/${INSPECTION_ID}/photos/${MEDIAID}.annotated.png`,
    );
    expect(r2.store.has(annotatedKey)).toBe(true);
  });
});
