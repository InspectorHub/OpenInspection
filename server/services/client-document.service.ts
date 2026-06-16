import { drizzle } from 'drizzle-orm/d1';
import { and, eq } from 'drizzle-orm';
import { clientUploads, type DocumentCategory, type DocumentVisibility, type UploaderKind } from '../lib/db/schema';
import { sanitizeFilename } from '../lib/content-disposition';
import { Errors } from '../lib/errors';

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
    const r2Key = `uploads/${tenantId}/${inspectionId}/${id}-${sanitizeFilename(meta.filename, 'file')}`;

    // Enforce MAX_BYTES against ACTUAL bytes (Content-Length is spoofable). For
    // non-stream bodies (unit tests) measure byteLength directly; for streams,
    // count bytes through a TransformStream and abort if the cap is exceeded.
    let measuredSize: number;
    if (body instanceof Uint8Array) {
      measuredSize = body.byteLength;
      await this.bucket.put(r2Key, body, { httpMetadata: { contentType: meta.contentType } });
    } else if (body instanceof ArrayBuffer) {
      measuredSize = body.byteLength;
      await this.bucket.put(r2Key, body, { httpMetadata: { contentType: meta.contentType } });
    } else {
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
        // R2 put is atomic on stream error: if the stream errors mid-flight the
        // object is NOT persisted. We re-throw PayloadTooLargeError so the route
        // can map it to 413.
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
