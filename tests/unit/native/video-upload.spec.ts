/**
 * Token-only video upload, through the REAL app.
 *
 * The session route for R2 video (`.../media/video/r2-upload`) still needs the
 * caller's access token, which a background upload may no longer have. The
 * public route trusts only the signed token `create-upload` minted. Each
 * refusal is paired with a positive control.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { AVIF_BYTES, HEIC_BYTES, HTML_BYTES, JPEG_BYTES, MOV_BYTES, MP4_BYTES, PNG_BYTES, SVG_BYTES, WEBM_BYTES, ZIP_BYTES } from '../helpers/media-bytes';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { r2Keys } from '../../../server/lib/r2-keys';
import { signUploadToken } from '../../../server/lib/video-upload-token';
import {
    createUploadHarness, filePart, jsonPost, tokenExp, INSPECTION_ID, INSPECTOR_ID, TENANT_ID, type UploadHarness,
} from '../helpers/native-upload-harness';

const CREATE = `/api/inspections/${INSPECTION_ID}/media/video/create-upload`;
const FINALIZE = `/api/inspections/${INSPECTION_ID}/media/video/finalize`;
const JWT_SECRET = 'j'.repeat(32);
const MP4 = MP4_BYTES;

interface R2Ref { provider: 'r2'; mediaId: string; r2Key: string }
interface CreateOut { uploadURL: string; provider: string; ref: R2Ref | { provider: 'stream'; streamUid: string } }

describe('video upload (real app)', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });

    async function create(opts: { auth?: string | null; env?: Record<string, unknown> } = {}): Promise<CreateOut> {
        u ??= await createUploadHarness();
        const res = await u.call(CREATE, jsonPost({}), opts);
        expect(res.status, await res.clone().text()).toBe(200);
        return (await res.json() as { data: CreateOut }).data;
    }
    const tokenOf = (uploadURL: string): string => new URL(uploadURL, 'http://x').searchParams.get('token') ?? '';
    const pathOf = (uploadURL: string): string => { const p = new URL(uploadURL); return p.pathname + p.search; };

    describe('R2 backend', () => {
        it('hands a native client the token-only URL with a 24 hour token', async () => {
            const out = await create();
            expect(out.provider).toBe('r2');
            expect(new URL(out.uploadURL).pathname).toBe('/api/public/uploads/video');
            const ttl = tokenExp(tokenOf(out.uploadURL)) - Math.floor(Date.now() / 1000);
            expect(ttl).toBeGreaterThan(86400 - 60);
            expect(ttl).toBeLessThanOrEqual(86400);
        });

        it('keeps the web editor on the session route with the 15 minute token', async () => {
            u = await createUploadHarness();
            const keyring = await buildKeyring(u.h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJwt({
                sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
            }, keyring);
            const out = await create({ auth: jwt });
            expect(new URL(out.uploadURL).pathname).toBe(`/api/inspections/${INSPECTION_ID}/media/video/r2-upload`);
            const ttl = tokenExp(tokenOf(out.uploadURL)) - Math.floor(Date.now() / 1000);
            expect(ttl).toBeGreaterThan(900 - 60);
            expect(ttl).toBeLessThanOrEqual(900);
        });

        it('stores an unauthenticated upload at the key the token fixes, and overwrites on a repeat', async () => {
            const out = await create();
            const ref = out.ref as R2Ref;
            const key = r2Keys.inspectionVideo(TENANT_ID, INSPECTION_ID, ref.mediaId, 'mp4');
            const first = await u!.call(pathOf(out.uploadURL), { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(first.status, await first.clone().text()).toBe(200);
            expect(((await first.json()) as { data: { mediaId: string; r2Key: string } }).data).toEqual({ mediaId: ref.mediaId, r2Key: key });
            expect(u!.r2.store.has(key)).toBe(true);
            const second = await u!.call(pathOf(out.uploadURL), { method: 'POST', body: filePart('video/mp4', new Uint8Array([...MP4, 1, 2, 3])) }, { auth: null });
            expect(second.status).toBe(200);
            expect(u!.r2.store.size).toBe(1);
            expect(u!.r2.store.get(key)?.bytes.length).toBe(MP4.length + 3);
        });

        it('answers 404 once native clients are switched off, even for a token minted while they were on', async () => {
            const out = await create();
            const url = pathOf(out.uploadURL);
            const off = await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null, env: { NATIVE_CLIENT_ENABLED: 'false' } });
            expect(off.status).toBe(404);
            expect(u!.r2.store.size).toBe(0);
            // Control: the same URL is accepted with the switch on.
            expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null })).status).toBe(200);
        });

        it('refuses a tampered or expired token with 401 and stores nothing', async () => {
            const out = await create();
            const url = pathOf(out.uploadURL);
            // Flip a character in the middle of the signature (the last one carries unused padding bits).
            const at = url.length - 12;
            const tampered = url.slice(0, at) + (url[at] === 'A' ? 'B' : 'A') + url.slice(at + 1);
            expect((await u!.call(tampered, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null })).status).toBe(401);
            const expired = await signUploadToken(
                { tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: (out.ref as R2Ref).mediaId }, -1, JWT_SECRET,
            );
            const old = await u!.call(`/api/public/uploads/video?token=${expired}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(old.status).toBe(401);
            expect(u!.r2.store.size).toBe(0);
            // Control: the untouched URL is accepted.
            expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null })).status).toBe(200);
        });

        it('decides the type from the bytes: an image or html declared as video is refused, a mislabelled or untyped clip is stored under its real type', async () => {
            const out = await create();
            const url = pathOf(out.uploadURL);
            const refused = [JPEG_BYTES, PNG_BYTES, HTML_BYTES, SVG_BYTES, HEIC_BYTES, AVIF_BYTES, ZIP_BYTES, new Uint8Array(0), MP4.subarray(0, 8)];
            for (const bytes of refused) {
                expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', bytes) }, { auth: null })).status).toBe(400);
            }
            expect((await u!.call(url, { method: 'POST', body: new FormData() }, { auth: null })).status).toBe(400);
            expect(u!.r2.store.size).toBe(0);
            // Controls: the same URL takes real clips, whatever they are declared as; the key extension follows the bytes.
            const cases: [Uint8Array<ArrayBuffer>, string, RegExp, string][] = [
                [MP4, 'application/octet-stream', /\.mp4$/, 'video/mp4'],
                [MP4, 'video/webm', /\.mp4$/, 'video/mp4'],
                [MOV_BYTES, 'video/mp4', /\.mov$/, 'video/quicktime'],
                [WEBM_BYTES, 'video/mp4', /\.webm$/, 'video/webm'],
            ];
            for (const [bytes, declared, ext, type] of cases) {
                u!.r2.store.clear();
                expect((await u!.call(url, { method: 'POST', body: filePart(declared, bytes) }, { auth: null })).status, declared).toBe(200);
                expect(u!.r2.store.size).toBe(1);
                const [key, stored] = [...u!.r2.store.entries()][0]!;
                expect(key).toMatch(ext);
                expect(stored.contentType).toBe(type);
            }
        });

        it('keeps working for the session route: the original r2-upload still takes its token', async () => {
            u = await createUploadHarness();
            const keyring = await buildKeyring(u.h.env as unknown as Record<string, string | undefined>);
            const now = Math.floor(Date.now() / 1000);
            const jwt = await signJwt({
                sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
            }, keyring);
            const out = await create({ auth: jwt });
            const res = await u.call(pathOf(out.uploadURL), { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: jwt });
            expect(res.status, await res.clone().text()).toBe(200);
            expect(u.r2.store.size).toBe(1);
            // Control: a token that is not signed for this inspection is refused on the same route.
            const foreign = await signUploadToken({ tenantId: TENANT_ID, inspectionId: 'another-inspection', mediaId: 'm1' }, 600, JWT_SECRET);
            const refused = await u.call(`/api/inspections/${INSPECTION_ID}/media/video/r2-upload?token=${foreign}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: jwt });
            expect(refused.status).toBe(401);
        });

        it('refuses an upload once its issuer was removed (401) or the inspection is gone (404), but not before', async () => {
            const out = await create();
            const url = pathOf(out.uploadURL);
            expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null })).status).toBe(200);
            u!.r2.store.clear();
            await u!.h.db.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, INSPECTOR_ID));
            const removed = await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(removed.status).toBe(401);
            await u!.h.db.update(schema.users).set({ deletedAt: null }).where(eq(schema.users.id, INSPECTOR_ID));
            await u!.h.db.delete(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID));
            const gone = await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(gone.status).toBe(404);
            expect(u!.r2.store.size).toBe(0);
        });

        it('still accepts a legacy video token that names no issuer, while the inspection exists', async () => {
            u = await createUploadHarness();
            const legacy = await signUploadToken({ tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: 'legacy-media' }, 600, JWT_SECRET);
            const ok = await u.call(`/api/public/uploads/video?token=${legacy}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(ok.status, await ok.clone().text()).toBe(200);
            await u.h.db.delete(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID));
            const gone = await u.call(`/api/public/uploads/video?token=${legacy}`, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            expect(gone.status).toBe(404);
        });

        it('requires a Content-Length (411) and refuses an oversized one (413)', async () => {
            const out = await create();
            const url = pathOf(out.uploadURL);
            const contentType = new Request('http://x/', { method: 'POST', body: filePart('video/mp4', MP4) }).headers.get('content-type') ?? '';
            const chunked = new ReadableStream<Uint8Array>({ start(ctl) { ctl.enqueue(MP4); ctl.close(); } });
            const noLength = await u!.call(url, { method: 'POST', headers: { 'content-type': contentType }, body: chunked, duplex: 'half' } as RequestInit, { auth: null });
            expect(noLength.status).toBe(411);
            const huge = await u!.call(url, { method: 'POST', headers: { 'content-type': contentType, 'content-length': String(300 * 1024 * 1024) }, body: MP4 }, { auth: null });
            expect(huge.status).toBe(413);
            expect(u!.r2.store.size).toBe(0);
            expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null })).status).toBe(200);
        });

        it('finalizes after a background upload, once, with a native token', async () => {
            const out = await create();
            const ref = out.ref as R2Ref;
            const up = await u!.call(pathOf(out.uploadURL), { method: 'POST', body: filePart('video/mp4', MP4) }, { auth: null });
            const { r2Key } = ((await up.json()) as { data: { r2Key: string } }).data;
            const finalizeBody = jsonPost({ provider: 'r2', mediaId: ref.mediaId, r2Key });
            const a = await u!.call(FINALIZE, finalizeBody);
            const b = await u!.call(FINALIZE, finalizeBody);
            expect(a.status, await a.clone().text()).toBe(200);
            expect(b.status).toBe(200);
            const first = ((await a.json()) as { data: { poolId: string; readyToStream: boolean } }).data;
            const second = ((await b.json()) as { data: { poolId: string } }).data;
            expect(first.readyToStream).toBe(true);
            expect(second.poolId).toBe(first.poolId);
            const rows = await u!.h.db.select().from(schema.inspectionMediaPool).where(eq(schema.inspectionMediaPool.inspectionId, INSPECTION_ID)).all();
            expect(rows).toHaveLength(1);
        });
    });

    describe('Stream backend (current behavior, pinned)', () => {
        const stream = {
            createDirectUpload: async () => ({ uploadURL: 'https://upload.videodelivery.net/one-shot', id: 'stream-uid-1' }),
        };

        async function streamHarness(): Promise<UploadHarness> {
            u = await createUploadHarness();
            await u.h.db.update(schema.tenantConfigs).set({
                videoMode: 'stream', integrationConfig: JSON.stringify({ streamCustomerSubdomain: 'customer-abc' }),
            }).where(eq(schema.tenantConfigs.tenantId, TENANT_ID));
            return u;
        }

        it('returns Cloudflare direct upload URL and a stream ref, for native and web callers alike', async () => {
            await streamHarness();
            const out = await create({ env: { STREAM: stream } });
            expect(out.provider).toBe('stream');
            expect(out.uploadURL).toBe('https://upload.videodelivery.net/one-shot');
            expect(out.ref).toEqual({ provider: 'stream', streamUid: 'stream-uid-1' });
        });

        it('finalizes a stream video through the native token', async () => {
            await streamHarness();
            const binding = {
                ...stream,
                video: () => ({
                    details: async () => ({
                        readyToStream: true, duration: 12.4, thumbnailTimestampPct: 0, status: { state: 'ready' },
                        meta: { tenantId: TENANT_ID, inspectionId: INSPECTION_ID },
                    }),
                }),
            };
            const res = await u!.call(FINALIZE, jsonPost({ provider: 'stream', streamUid: 'stream-uid-1' }), { env: { STREAM: binding } });
            expect(res.status, await res.clone().text()).toBe(200);
            const data = ((await res.json()) as { data: { streamUid: string; readyToStream: boolean; durationSec: number } }).data;
            expect(data).toMatchObject({ streamUid: 'stream-uid-1', readyToStream: true, durationSec: 12 });
        });
    });
});
