/**
 * Signed photo upload URLs, through the REAL app.
 *
 * A background upload can outlive the access token that queued it, so the
 * upload route carries no session: it trusts only a signed token. Each refusal
 * below is paired with a positive control on the same harness.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../../server/lib/db/schema';
import { signUploadToken } from '../../../server/lib/video-upload-token';
import {
    createUploadHarness, filePart, jsonPost, INSPECTION_ID, INSPECTOR_ID, OTHER_TENANT_INSPECTION_ID, TENANT_ID, type UploadHarness,
} from '../helpers/native-upload-harness';

const PENDING = '55555555-0000-4000-8000-000000000001';
const UPLOAD_URL = `/api/inspections/${INSPECTION_ID}/media/upload-url`;
const JWT_SECRET = 'j'.repeat(32);
const EXPECTED_KEY = `${TENANT_ID}/inspections/${INSPECTION_ID}/photos/${PENDING}.jpg`;
const MINT_BODY = { pendingId: PENDING, contentType: 'image/jpeg' };

describe('photo upload URL (real app)', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });

    async function mint(body: unknown = MINT_BODY, path = UPLOAD_URL) {
        u ??= await createUploadHarness();
        return u.call(path, jsonPost(body));
    }
    async function mintUrl(): Promise<{ url: string; key: string }> {
        const res = await mint();
        expect(res.status, await res.clone().text()).toBe(200);
        return (await res.json() as { data: { url: string; key: string } }).data;
    }

    it('mints a relative signed URL and the key derived from the pending id', async () => {
        const res = await mint();
        expect(res.status, await res.clone().text()).toBe(200);
        const { data } = await res.json() as { data: { url: string; key: string; expiresAt: number } };
        expect(data.url.startsWith('/api/public/uploads/photo?token=')).toBe(true);
        expect(data.key).toBe(EXPECTED_KEY);
        expect(data.key).toContain(PENDING);
        expect(data.expiresAt).toBeGreaterThan(Date.now() + 23 * 3600 * 1000);
    });

    it('accepts an upload to that URL with NO Authorization header and stores it at the key', async () => {
        const { url, key } = await mintUrl();
        const res = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as { data: { key: string } }).data.key).toBe(key);
        expect(u!.r2.store.has(key)).toBe(true);
        expect(u!.r2.store.size).toBe(1);
    });

    it('overwrites on a repeat upload of the same URL instead of adding an object', async () => {
        const { url, key } = await mintUrl();
        const first = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        const second = await u!.call(url, { method: 'POST', body: filePart('image/jpeg', new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0x09, 0x09])) }, { auth: null });
        expect(first.status).toBe(200);
        expect(second.status, await second.clone().text()).toBe(200);
        expect(u!.r2.store.size).toBe(1);
        expect(u!.r2.store.get(key)?.bytes.length).toBe(6);
    });

    it('mints the same key for the same pending id on a repeated request', async () => {
        const a = await mintUrl();
        const b = await mintUrl();
        expect(b.key).toBe(a.key);
    });

    it('refuses a tampered token and an expired token with 401, and stores nothing', async () => {
        const { url } = await mintUrl();
        // Flip a character in the middle of the signature: the last one of a base64url
        // HMAC carries unused padding bits, so changing only that one can leave it valid.
        const at = url.length - 12;
        const tampered = url.slice(0, at) + (url[at] === 'A' ? 'B' : 'A') + url.slice(at + 1);
        const bad = await u!.call(tampered, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(bad.status).toBe(401);

        const expired = await signUploadToken(
            { tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: PENDING, ext: 'jpg' }, -1, JWT_SECRET, 'photo',
        );
        const old = await u!.call(`/api/public/uploads/photo?token=${expired}`, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(old.status).toBe(401);
        expect(u!.r2.store.size).toBe(0);

        // Control: the untouched URL works on the same harness.
        const ok = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(ok.status).toBe(200);
    });

    it('does not turn an old app version into a 426 on upload-url or on the upload', async () => {
        u = await createUploadHarness();
        const policy = { NATIVE_MIN_VERSION_IOS: '1.2.0' };
        const old = { 'X-Client-Platform': 'ios', 'X-Client-Version': '1.0.0' };
        const minted = await u.call(UPLOAD_URL, {
            method: 'POST', headers: { 'content-type': 'application/json', ...old }, body: JSON.stringify(MINT_BODY),
        }, { env: policy });
        expect(minted.status, await minted.clone().text()).toBe(200);
        expect(minted.headers.get('X-Client-Upgrade')).toBe('required');
        const { url } = (await minted.json() as { data: { url: string } }).data;
        const sent = await u.call(url, { method: 'POST', headers: old, body: filePart('image/jpeg') }, { auth: null, env: policy });
        expect(sent.status, await sent.clone().text()).toBe(200);
        // Control: the same old version IS refused on an ordinary route.
        const ordinary = await u.call('/api/inspections', { headers: old }, { env: policy });
        expect(ordinary.status).toBe(426);
    });

    it('offers no URL without a native session, and none at all when native access is switched off', async () => {
        u = await createUploadHarness();
        // Control: native + flag on is served.
        expect((await u.call(UPLOAD_URL, jsonPost(MINT_BODY))).status).toBe(200);
        // Flag off: the native token no longer resolves, so there is no caller to sign for.
        const off = await u.call(UPLOAD_URL, jsonPost(MINT_BODY), { env: { NATIVE_CLIENT_ENABLED: 'false' } });
        expect(off.status).toBe(401);
        // No credentials at all.
        const anon = await u.call(UPLOAD_URL, jsonPost(MINT_BODY), { auth: null });
        expect(anon.status).toBe(401);
    });

    it('answers 404 for another workspace inspection', async () => {
        u = await createUploadHarness();
        const res = await u.call(`/api/inspections/${OTHER_TENANT_INSPECTION_ID}/media/upload-url`, jsonPost(MINT_BODY));
        expect(res.status).toBe(404);
        // Control: its own inspection is served.
        expect((await u.call(UPLOAD_URL, jsonPost(MINT_BODY))).status).toBe(200);
    });

    it('rejects a content type outside jpeg, png and heic, and a pending id with unsafe characters', async () => {
        expect((await mint({ pendingId: PENDING, contentType: 'image/gif' })).status).toBe(400);
        expect((await mint({ pendingId: '../escape', contentType: 'image/jpeg' })).status).toBe(400);
        expect((await mint({ pendingId: PENDING, contentType: 'image/png' })).status).toBe(200);
        expect((await mint({ pendingId: PENDING, contentType: 'image/heic' })).status).toBe(200);
    });

    it('stores at the token destination only: query parameters cannot redirect the upload', async () => {
        const { url, key } = await mintUrl();
        const hijack = `${url}&tenantId=${TENANT_ID}x&inspectionId=other&mediaId=other&key=evil/path.jpg`;
        const res = await u!.call(hijack, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(res.status, await res.clone().text()).toBe(200);
        expect([...u!.r2.store.keys()]).toEqual([key]);
    });

    it('refuses a type that differs from the one the URL was minted for, an oversized photo, and a missing file', async () => {
        const { url, key } = await mintUrl();
        const wrongType = await u!.call(url, { method: 'POST', body: filePart('image/png') }, { auth: null });
        expect(wrongType.status).toBe(400);
        const huge = await u!.call(url, { method: 'POST', body: filePart('image/jpeg', new Uint8Array(10 * 1024 * 1024 + 1)) }, { auth: null });
        expect(huge.status).toBe(413);
        const empty = await u!.call(url, { method: 'POST', body: new FormData() }, { auth: null });
        expect(empty.status).toBe(400);
        expect(u!.r2.store.size).toBe(0);
        // Control: the right type goes through.
        const ok = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(ok.status).toBe(200);
        expect(u!.r2.store.has(key)).toBe(true);
    });

    it('refuses an upload once the inspection is gone (404), but not before', async () => {
        const { url } = await mintUrl();
        const before = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(before.status, await before.clone().text()).toBe(200);
        u!.r2.store.clear();
        await u!.h.db.delete(schema.inspections).where(eq(schema.inspections.id, INSPECTION_ID));
        const after = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(after.status).toBe(404);
        expect(u!.r2.store.size).toBe(0);
    });

    it('refuses an upload from a token whose issuer has since been removed (401), but not before', async () => {
        const { url } = await mintUrl();
        const before = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(before.status, await before.clone().text()).toBe(200);
        u!.r2.store.clear();
        await u!.h.db.update(schema.users).set({ deletedAt: new Date() }).where(eq(schema.users.id, INSPECTOR_ID));
        const after = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(after.status).toBe(401);
        expect(u!.r2.store.size).toBe(0);
    });

    it('refuses a photo token that names no issuer (401); the same token with an issuer is accepted', async () => {
        u = await createUploadHarness();
        const claims = { tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: PENDING, ext: 'jpg' };
        const anonymous = await signUploadToken(claims, 600, JWT_SECRET, 'photo');
        const named = await signUploadToken({ ...claims, userId: INSPECTOR_ID }, 600, JWT_SECRET, 'photo');
        const refused = await u.call(`/api/public/uploads/photo?token=${anonymous}`, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(refused.status).toBe(401);
        expect(u.r2.store.size).toBe(0);
        const ok = await u.call(`/api/public/uploads/photo?token=${named}`, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('requires a Content-Length (411) and refuses an oversized one (413) before reading the body', async () => {
        const { url } = await mintUrl();
        const contentType = new Request('http://x/', { method: 'POST', body: filePart('image/jpeg') }).headers.get('content-type') ?? '';
        const chunked = new ReadableStream<Uint8Array>({ start(ctl) { ctl.enqueue(new Uint8Array([1])); ctl.close(); } });
        const noLength = await u!.call(url, { method: 'POST', headers: { 'content-type': contentType }, body: chunked, duplex: 'half' } as RequestInit, { auth: null });
        expect(noLength.status).toBe(411);
        const junk = await u!.call(url, { method: 'POST', headers: { 'content-type': contentType, 'content-length': 'abc' }, body: new Uint8Array([1]) }, { auth: null });
        expect(junk.status).toBe(411);
        const huge = await u!.call(url, { method: 'POST', headers: { 'content-type': contentType, 'content-length': String(50 * 1024 * 1024) }, body: new Uint8Array([1]) }, { auth: null });
        expect(huge.status).toBe(413);
        expect(u!.r2.store.size).toBe(0);
        // Control: the ordinary request, which carries a correct length, goes through.
        const ok = await u!.call(url, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(ok.status, await ok.clone().text()).toBe(200);
    });

    it('keeps photo and video tokens apart in both directions', async () => {
        u = await createUploadHarness();
        const claims = { tenantId: TENANT_ID, inspectionId: INSPECTION_ID, mediaId: PENDING };
        const photoToken = await signUploadToken({ ...claims, ext: 'jpg', userId: INSPECTOR_ID }, 600, JWT_SECRET, 'photo');
        const videoToken = await signUploadToken(claims, 600, JWT_SECRET);
        const photoOnVideo = await u.call(`/api/public/uploads/video?token=${photoToken}`, { method: 'POST', body: filePart('video/mp4') }, { auth: null });
        const videoOnPhoto = await u.call(`/api/public/uploads/photo?token=${videoToken}`, { method: 'POST', body: filePart('image/jpeg') }, { auth: null });
        expect(photoOnVideo.status).toBe(401);
        expect(videoOnPhoto.status).toBe(401);
        expect(u.r2.store.size).toBe(0);
        // Controls: each token works on its own route.
        expect((await u.call(`/api/public/uploads/photo?token=${photoToken}`, { method: 'POST', body: filePart('image/jpeg') }, { auth: null })).status).toBe(200);
        expect((await u.call(`/api/public/uploads/video?token=${videoToken}`, { method: 'POST', body: filePart('video/mp4') }, { auth: null })).status).toBe(200);
    });
});
