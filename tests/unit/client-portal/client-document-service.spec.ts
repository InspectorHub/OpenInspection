import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as schema from '../../../server/lib/db/schema';
import { createTestDb, setupSchema } from '../db';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

vi.mock('drizzle-orm/d1', () => ({ drizzle: vi.fn() }));
import { drizzle as mockDrizzle } from 'drizzle-orm/d1';
import {
  ClientDocumentService, ALLOWED_EXTENSIONS, CAD_EXTENSIONS, MAX_BYTES, MAX_FILES, PayloadTooLargeError,
} from '../../../server/services/client-document.service';

const TENANT = 't1';
const INSP = 'insp1';

function fakeBucket() {
  const store = new Map<string, Uint8Array>();
  return {
    store,
    // Mirrors the real R2 put(key, value, options) for the NODE unit-test runner.
    // NOTE: production streams via a workerd-only FixedLengthStream (records the
    // DECLARED Content-Length and enforces it) — that path is NOT unit-testable
    // and is covered by E2E. Under Node the service falls back to a byte-counting
    // TransformStream, so this fake drains the stream (the counter runs and can
    // error). If the stream errors mid-flight, nothing is persisted (atomic on error).
    put: vi.fn(async (key: string, body: ReadableStream | Uint8Array | ArrayBuffer) => {
      if (body instanceof Uint8Array) { store.set(key, body); return { key }; }
      if (body instanceof ArrayBuffer) { store.set(key, new Uint8Array(body)); return { key }; }
      const reader = (body as ReadableStream<Uint8Array>).getReader();
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read(); // throws if the stream errors
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const bytes = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) { bytes.set(c, off); off += c.length; }
      store.set(key, bytes);
      return { key };
    }),
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
    expect(row.r2Key).toMatch(/^t1\/inspections\/insp1\/documents\/id-1-/);
    expect(row.filename).toBe('My Roof Report.pdf');
    expect(bucket.store.has(row.r2Key)).toBe(true);
    expect((await svc.list(TENANT, INSP)).map((u) => u.id)).toContain(row.id);
    await svc.remove(TENANT, row.id);
    expect((await svc.list(TENANT, INSP)).length).toBe(0);
    expect(bucket.store.has(row.r2Key)).toBe(false);
  });

  // Exercises the NODE FALLBACK stream branch (no FixedLengthStream global), which
  // counts ACTUAL bytes. The PRODUCTION workerd path uses FixedLengthStream — it
  // records the DECLARED Content-Length and aborts on a length mismatch, and is
  // covered by E2E (not unit-testable here). This test asserts the fallback's
  // cap-enforcing byte counting still works under Node.
  it('create from a ReadableStream (Node fallback) counts ACTUAL bytes, not a lied-about Content-Length', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const row = await svc.create(TENANT, INSP,
      { kind: 'client', ref: 'a@x.com', name: 'Ann' },
      // meta.sizeBytes is a lie (999); the real stream is only 3 bytes.
      { filename: 'lie.pdf', contentType: 'application/pdf', category: 'other', visibility: 'client_visible', label: null, sizeBytes: 999 },
      stream);
    expect(row.sizeBytes).toBe(3); // fallback measures the actual stream
    expect(bucket.store.get(row.r2Key)).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('count is per uploader ref', async () => {
    await svc.create(TENANT, INSP, { kind: 'client', ref: 'a@x.com', name: null },
      { filename: 'a.pdf', contentType: 'application/pdf', category: 'other', visibility: 'client_visible', label: null, sizeBytes: 1 }, new Uint8Array([1]));
    expect(await svc.countForUploader(TENANT, INSP, 'a@x.com')).toBe(1);
    expect(await svc.countForUploader(TENANT, INSP, 'b@x.com')).toBe(0);
  });
});
