import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { clientUploads, type DocumentCategory, type DocumentVisibility, type UploaderKind } from '../lib/db/schema';
import { sanitizeFilename } from '../lib/content-disposition';
import { Errors } from '../lib/errors';
import { r2Keys } from '../lib/r2-keys';

export const MAX_BYTES = 100 * 1024 * 1024; // 100 MB
export const MAX_FILES = 50;

export const ALLOWED_EXTENSIONS = new Set([
  'pdf', 'jpg', 'jpeg', 'png', 'heic', 'heif', 'webp',
  'doc', 'docx', 'xls', 'xlsx', 'csv', 'dwg', 'dxf',
]);
export const CAD_EXTENSIONS = new Set(['dwg', 'dxf']);
export const ALLOWED_CONTENT_TYPES = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
]);

const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

/** Thrown when an upload stream exceeds MAX_BYTES mid-stream (maps to HTTP 413). */
export class PayloadTooLargeError extends Error {
  constructor(message = 'File exceeds 100 MB.') {
    super(message);
    this.name = 'PayloadTooLargeError';
  }
}

export interface UploadMeta {
  filename: string;
  contentType: string;
  category: DocumentCategory;
  visibility: DocumentVisibility;
  label: string | null;
  sizeBytes: number;
}

export class ClientDocumentService {
  constructor(
    private d1: D1Database,
    private bucket: R2Bucket,
    private genId: () => string = () => crypto.randomUUID(),
    private now: () => number = () => Date.now(),
  ) {}
  private db() { return drizzle(this.d1); }

  assertValid(p: { filename: string; contentType: string; sizeBytes: number; currentCount: number }) {
    const ext = extOf(p.filename);
    if (!ALLOWED_EXTENSIONS.has(ext)) throw Errors.BadRequest('File type not allowed.');
    if (!CAD_EXTENSIONS.has(ext) && !ALLOWED_CONTENT_TYPES.has(p.contentType)) {
      throw Errors.BadRequest('File type not allowed.');
    }
    if (p.sizeBytes > MAX_BYTES) throw Errors.BadRequest('File exceeds 100 MB.');
    if (p.currentCount >= MAX_FILES) throw Errors.BadRequest('Upload limit reached (50 files).');
  }

  async countForUploader(tenantId: string, inspectionId: string, ref: string): Promise<number> {
    const rows = await this.db().select().from(clientUploads)
      .where(and(eq(clientUploads.tenantId, tenantId), eq(clientUploads.inspectionId, inspectionId), eq(clientUploads.uploadedByRef, ref)))
      .all();
    return rows.length;
  }

  async create(
    tenantId: string,
    inspectionId: string,
    by: { kind: UploaderKind; ref: string; name: string | null },
    meta: UploadMeta,
    body: ReadableStream | Uint8Array | ArrayBuffer,
  ): Promise<typeof clientUploads.$inferSelect> {
    const currentCount = await this.countForUploader(tenantId, inspectionId, by.ref);
    this.assertValid({ filename: meta.filename, contentType: meta.contentType, sizeBytes: meta.sizeBytes, currentCount });
    const id = this.genId();
    const r2Key = r2Keys.inspectionDocument(tenantId, inspectionId, id, sanitizeFilename(meta.filename, 'file'));

    // Enforce MAX_BYTES against ACTUAL bytes (Content-Length is spoofable). The
    // non-stream branches (Uint8Array/ArrayBuffer) measure byteLength directly and
    // are exercised by the unit tests. The ReadableStream branch is the real
    // client/inspector path (`c.req.raw.body`) and is E2E-verified against workerd
    // (FixedLengthStream is a workerd-only global, so it is NOT unit-testable).
    let measuredSize: number;
    if (body instanceof Uint8Array) {
      measuredSize = body.byteLength;
      await this.bucket.put(r2Key, body, { httpMetadata: { contentType: meta.contentType } });
    } else if (body instanceof ArrayBuffer) {
      measuredSize = body.byteLength;
      await this.bucket.put(r2Key, body, { httpMetadata: { contentType: meta.contentType } });
    } else if (typeof FixedLengthStream !== 'undefined') {
      // PRODUCTION (workerd) path — E2E-verified; NOT reachable under the Node
      // unit-test runner because FixedLengthStream is a workerd-only global.
      // R2 put requires a known content length; FixedLengthStream supplies it AND
      // enforces that the actual bytes equal the declared (Content-Length-derived)
      // size — a client that under-declares to stream unbounded data gets aborted.
      // meta.sizeBytes is already validated <= MAX_BYTES upstream (route 413 fast-path
      // + assertValid), so this also bounds the stored object to the cap.
      const fls = new FixedLengthStream(meta.sizeBytes);
      // pump the request body into the fixed-length stream; R2 reads the readable end.
      const pumped = body.pipeThrough(fls as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
      try {
        await this.bucket.put(r2Key, pumped, { httpMetadata: { contentType: meta.contentType } });
      } catch {
        // A length mismatch (client lied about Content-Length) surfaces here.
        throw new PayloadTooLargeError();
      }
      measuredSize = meta.sizeBytes;
    } else {
      // FALLBACK for the Node unit-test runner only (no FixedLengthStream global).
      // Counts ACTUAL bytes through a TransformStream and aborts the put if the
      // MAX_BYTES cap is exceeded — preserving the cap-enforcement property the
      // workerd FixedLengthStream gives us. The production path above is the one
      // that ships; this branch never executes in workerd.
      let total = 0;
      let overflowed = false;
      const counter = new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          total += chunk.byteLength;
          if (total > MAX_BYTES) {
            overflowed = true;
            controller.error(new PayloadTooLargeError());
            return;
          }
          controller.enqueue(chunk);
        },
      });
      try {
        await this.bucket.put(r2Key, body.pipeThrough(counter), { httpMetadata: { contentType: meta.contentType } });
      } catch (err) {
        if (overflowed || err instanceof PayloadTooLargeError) throw new PayloadTooLargeError();
        throw err;
      }
      measuredSize = total;
    }

    const row = {
      id, tenantId, inspectionId,
      uploadedByKind: by.kind, uploadedByRef: by.ref, uploadedByName: by.name,
      category: meta.category, visibility: meta.visibility,
      r2Key, filename: meta.filename, contentType: meta.contentType,
      sizeBytes: measuredSize, label: meta.label,
      createdAt: new Date(this.now()),
    };
    await this.db().insert(clientUploads).values(row);
    return row as typeof clientUploads.$inferSelect;
  }

  async list(tenantId: string, inspectionId: string) {
    return this.db().select().from(clientUploads)
      .where(and(eq(clientUploads.tenantId, tenantId), eq(clientUploads.inspectionId, inspectionId)))
      .all();
  }

  async get(tenantId: string, id: string) {
    return this.db().select().from(clientUploads)
      .where(and(eq(clientUploads.tenantId, tenantId), eq(clientUploads.id, id)))
      .get();
  }

  async getObject(r2Key: string) { return this.bucket.get(r2Key); }

  async remove(tenantId: string, id: string) {
    const row = await this.get(tenantId, id);
    if (!row) return;
    try { await this.bucket.delete(row.r2Key); } catch { /* non-fatal: orphan object */ }
    await this.db().delete(clientUploads)
      .where(and(eq(clientUploads.tenantId, tenantId), eq(clientUploads.id, id)));
  }
}
