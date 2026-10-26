/**
 * Shared calls for the chunked video upload specs: the real app over the signed-upload harness, with
 * one function per route and small readers for the ledger. A kit owns one harness; `close()` it after each test.
 */
import { and, eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { signUploadToken } from '../../../server/lib/video-upload-token';
import { VIDEO_PART_BYTES } from '../../../server/services/video/chunked-upload.service';
import { MP4_BYTES } from './media-bytes';
import { createUploadHarness, INSPECTION_ID, INSPECTOR_ID, TENANT_ID, type UploadHarness } from './native-upload-harness';

export const JWT_SECRET = 'j'.repeat(32);
export const BASE = '/api/public/uploads/video/chunked';
export const PART = VIDEO_PART_BYTES;
export const TWO = PART + 100; // two parts
export const THREE = 2 * PART + 100; // three parts

/** `size` bytes that begin with `head`. */
export function bytes(size: number, head: Uint8Array = MP4_BYTES): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(size);
    out.set(head.subarray(0, Math.min(head.length, size)));
    return out;
}

type Claims = Parameters<typeof signUploadToken>[0];

export function createChunkedKit() {
    let harness: UploadHarness | undefined;
    const kit = {
        async h(): Promise<UploadHarness> { return (harness ??= await createUploadHarness()); },
        /** The harness once a call has created it. */
        get u(): UploadHarness { return harness!; },
        close(): void { harness?.close(); harness = undefined; },

        token: (mediaId: string, claims: Partial<Claims> = {}, ttl = 86400): Promise<string> =>
            signUploadToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId, userId: INSPECTOR_ID, ...claims }, ttl, JWT_SECRET),

        async open(mediaId: string, totalBytes: number, tok?: string, env?: Record<string, unknown>): Promise<Response> {
            const h = await kit.h();
            return h.call(`${BASE}?token=${tok ?? await kit.token(mediaId)}`, {
                method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ totalBytes }),
            }, { auth: null, ...(env ? { env } : {}) });
        },
        async put(mediaId: string, n: number | string, body: Uint8Array<ArrayBuffer>, tok?: string): Promise<Response> {
            const h = await kit.h();
            return h.call(`${BASE}/parts/${n}?token=${tok ?? await kit.token(mediaId)}`, {
                method: 'PUT', headers: { 'content-length': String(body.byteLength) }, body,
            }, { auth: null });
        },
        async finish(mediaId: string, tok?: string): Promise<Response> {
            const h = await kit.h();
            return h.call(`${BASE}/complete?token=${tok ?? await kit.token(mediaId)}`, { method: 'POST' }, { auth: null });
        },
        async cancel(mediaId: string, tok?: string): Promise<Response> {
            const h = await kit.h();
            return h.call(`${BASE}?token=${tok ?? await kit.token(mediaId)}`, { method: 'DELETE' }, { auth: null });
        },

        json: async <T = Record<string, unknown>>(res: Response): Promise<T> => (await res.json()) as T,
        code: async (res: Response): Promise<unknown> => ((await res.json()) as { code?: string }).code,

        /** Open an upload of `total` bytes and send every part; the first begins with `head`. */
        async sendAll(mediaId: string, total: number, head: Uint8Array = MP4_BYTES): Promise<void> {
            const opened = await kit.open(mediaId, total);
            if (opened.status !== 200) throw new Error(`open answered ${opened.status}`);
            const count = Math.ceil(total / PART);
            for (let n = 1; n <= count; n += 1) {
                const size = n < count ? PART : total - (count - 1) * PART;
                const res = await kit.put(mediaId, n, bytes(size, n === 1 ? head : new Uint8Array(0)));
                if (res.status !== 200) throw new Error(`part ${n} answered ${res.status}`);
            }
        },
        async ledger(mediaId: string) {
            return (await kit.u.h.db.select().from(schema.videoUploads)
                .where(and(eq(schema.videoUploads.tenantId, TENANT_ID), eq(schema.videoUploads.mediaId, mediaId))).all())[0];
        },
        async partRows(mediaId: string) {
            return kit.u.h.db.select().from(schema.videoUploadParts)
                .where(and(eq(schema.videoUploadParts.tenantId, TENANT_ID), eq(schema.videoUploadParts.mediaId, mediaId))).all();
        },
    };
    return kit;
}
