import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../server/lib/db/schema';
import { createTestDb, setupSchema } from './db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
  ClientDocumentService, ALLOWED_EXTENSIONS, CAD_EXTENSIONS, MAX_BYTES, MAX_FILES,
} from '../../server/services/client-document.service';

const TENANT = 't1';
const INSP = 'insp1';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    put: vi.fn(async (key: string, body: Uint8Array) => { store.set(key, body); }),
    get: vi.fn(async (key: string) => store.has(key) ? { body: store.get(key) } : null),
    delete: vi.fn(async (key: string) => { store.delete(key); }),
  };
}

describe('ClientDocumentService', () => {
  let db: BetterSQLite3Database<typeof schema>;
  let bucket: ReturnType<typeof fakeBucket>;
  let svc: ClientDocumentService;
  let n = 0;

  beforeEach(async () => {
    const fixture = createTestDb();
    db = fixture.db;
    await setupSchema(fixture.sqlite);
    (mockDrizzle as unknown as ReturnType<typeof vi.fn>).mockReturnValue(db);
    bucket = fakeBucket();
    svc = new ClientDocumentService({} as D1Database, bucket as unknown as R2Bucket,
      () => `id-${++n}`, () => 1000);
  });

  it('rejects disallowed extensions and oversize/over-count', () => {
    expect(() => svc.assertValid({ filename: 'x.exe', contentType: 'application/x-msdownload', sizeBytes: 10, currentCount: 0 })).toThrow();
    expect(() => svc.assertValid({ filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: MAX_BYTES + 1, currentCount: 0 })).toThrow();
    expect(() => svc.assertValid({ filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, currentCount: MAX_FILES })).toThrow();
    expect(() => svc.assertValid({ filename: 'a.pdf', contentType: 'application/pdf', sizeBytes: 10, currentCount: 0 })).not.toThrow();
  });

  it('accepts CAD by extension even when content-type is octet-stream', () => {
    expect(CAD_EXTENSIONS.has('dwg')).toBe(true);
    expect(() => svc.assertValid({ filename: 'floor.dwg', contentType: 'application/octet-stream', sizeBytes: 10, currentCount: 0 })).not.toThrow();
    expect(() => svc.assertValid({ filename: 'a.pdf', contentType: 'application/octet-stream', sizeBytes: 10, currentCount: 0 })).toThrow();
  });

  it('create stores to R2 under the prefix, keeps the ORIGINAL filename, lists, and removes both', async () => {
    const row = await svc.create(TENANT, INSP,
      { kind: 'client', ref: 'a@x.com', name: 'Ann' },
      { filename: 'My Roof Report.pdf', contentType: 'application/pdf', category: 'prior_reports', visibility: 'client_visible', label: null, sizeBytes: 3 },
      new Uint8Array([1, 2, 3]));
    expect(row.r2Key).toMatch(/^uploads\/t1\/insp1\/id-1-/);
    expect(row.filename).toBe('My Roof Report.pdf');
    expect(bucket.store.has(row.r2Key)).toBe(true);
    expect((await svc.list(TENANT, INSP)).map((u) => u.id)).toContain(row.id);
    await svc.remove(TENANT, row.id);
    expect((await svc.list(TENANT, INSP)).length).toBe(0);
    expect(bucket.store.has(row.r2Key)).toBe(false);
  });

  it('count is per uploader ref', async () => {
    await svc.create(TENANT, INSP, { kind: 'client', ref: 'a@x.com', name: null },
      { filename: 'a.pdf', contentType: 'application/pdf', category: 'other', visibility: 'client_visible', label: null, sizeBytes: 1 }, new Uint8Array([1]));
    expect(await svc.countForUploader(TENANT, INSP, 'a@x.com')).toBe(1);
    expect(await svc.countForUploader(TENANT, INSP, 'b@x.com')).toBe(0);
  });
});
