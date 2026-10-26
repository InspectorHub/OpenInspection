/**
 * The single-request (multipart form) video route buffers the whole clip, so it has a lower cap than the
 * chunked route: 64 MiB. Over it the answer is 413 VIDEO_TOO_LARGE_FOR_FORM and names the chunked route.
 * The web editor's session route is a different route with its own limit and must not move.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { buildKeyring, signJwt } from '../../../server/lib/jwt-keyring';
import { MAX_FORM_VIDEO_BYTES, MAX_VIDEO_BYTES } from '../../../server/lib/media/video-types';
import { MP4_BYTES } from '../helpers/media-bytes';
import {
    createUploadHarness, filePart, jsonPost, INSPECTION_ID, INSPECTOR_ID, TENANT_ID, type UploadHarness,
} from '../helpers/native-upload-harness';

const CREATE = `/api/inspections/${INSPECTION_ID}/media/video/create-upload`;

function clip(size: number): Uint8Array<ArrayBuffer> {
    const out = new Uint8Array(size);
    out.set(MP4_BYTES);
    return out;
}

describe('single-request video upload cap', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });

    async function nativeUrl(): Promise<string> {
        u ??= await createUploadHarness();
        const res = await u.call(CREATE, jsonPost({}));
        const { uploadURL } = ((await res.json()) as { data: { uploadURL: string } }).data;
        const parsed = new URL(uploadURL);
        return parsed.pathname + parsed.search;
    }

    it('is 64 MiB, and below the chunked limit', () => {
        expect(MAX_FORM_VIDEO_BYTES).toBe(64 * 1024 * 1024);
        expect(MAX_FORM_VIDEO_BYTES).toBeLessThan(MAX_VIDEO_BYTES);
    });

    it('refuses a declared length over the cap before reading the body, and names the chunked route', async () => {
        const url = await nativeUrl();
        const contentType = new Request('http://x/', { method: 'POST', body: filePart('video/mp4', clip(64)) }).headers.get('content-type') ?? '';
        const huge = await u!.call(url, {
            method: 'POST', headers: { 'content-type': contentType, 'content-length': String(MAX_FORM_VIDEO_BYTES + 2 * 1024 * 1024) }, body: clip(64),
        }, { auth: null });
        expect(huge.status).toBe(413);
        expect(await huge.json()).toMatchObject({
            code: 'VIDEO_TOO_LARGE_FOR_FORM', limits: { maxBytes: MAX_FORM_VIDEO_BYTES, chunkedPath: '/api/public/uploads/video/chunked' },
        });
        expect(u!.r2.store.size).toBe(0);
        // Control: a small clip goes through.
        expect((await u!.call(url, { method: 'POST', body: filePart('video/mp4', clip(1024)) }, { auth: null })).status).toBe(200);
    });

    it('refuses a clip over the cap that hides under the declared-length allowance, and takes one exactly at the cap', async () => {
        const url = await nativeUrl();
        const over = await u!.call(url, { method: 'POST', body: filePart('video/mp4', clip(MAX_FORM_VIDEO_BYTES + 10)) }, { auth: null });
        expect(over.status).toBe(413);
        expect(await over.json()).toMatchObject({ code: 'VIDEO_TOO_LARGE_FOR_FORM', limits: { maxBytes: MAX_FORM_VIDEO_BYTES } });
        expect(u!.r2.store.size).toBe(0);
        const exact = await u!.call(url, { method: 'POST', body: filePart('video/mp4', clip(MAX_FORM_VIDEO_BYTES)) }, { auth: null });
        expect(exact.status, await exact.clone().text()).toBe(200);
        expect([...u!.r2.store.values()][0]?.bytes.length).toBe(MAX_FORM_VIDEO_BYTES);
    });

    it('leaves the web editor\'s session route at the larger limit', async () => {
        u = await createUploadHarness();
        const keyring = await buildKeyring(u.h.env as unknown as Record<string, string | undefined>);
        const now = Math.floor(Date.now() / 1000);
        const jwt = await signJwt({
            sub: INSPECTOR_ID, role: 'inspector', 'custom:userRole': 'inspector', 'custom:tenantId': TENANT_ID, iat: now, exp: now + 3600,
        }, keyring);
        const created = await u.call(CREATE, jsonPost({}), { auth: jwt });
        const { uploadURL } = ((await created.json()) as { data: { uploadURL: string } }).data;
        const parsed = new URL(uploadURL);
        const res = await u.call(parsed.pathname + parsed.search, { method: 'POST', body: filePart('video/mp4', clip(MAX_FORM_VIDEO_BYTES + 10)) }, { auth: jwt });
        expect(res.status, await res.clone().text()).toBe(200);
    });
});
