/**
 * The three image upload routes that take a file from the client (item photo, media-pool photo, profile photo),
 * through the REAL app: the declared type is not trusted, the bytes decide, and a refused file stores nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MAX_PHOTO_BYTES } from '@core/field-ui/shared/photo-limits';
import { createUploadHarness, INSPECTION_ID, type UploadHarness } from '../helpers/native-upload-harness';
import {
    AVIF_BYTES, EXE_BYTES, HEIC_BYTES, HTML_BYTES, JPEG_BYTES, PNG_BYTES, SVG_BYTES, WEBP_BYTES, ZIP_BYTES,
} from '../helpers/media-bytes';

function form(field: string, type: string, bytes: Uint8Array<ArrayBuffer>, extra: Record<string, string> = {}): FormData {
    const fd = new FormData();
    fd.append(field, new Blob([bytes], { type }), 'upload');
    for (const [k, v] of Object.entries(extra)) fd.append(k, v);
    return fd;
}

const ROUTES = {
    'item photo': { path: `/api/inspections/${INSPECTION_ID}/upload`, field: 'file', extra: { itemId: 'item-1' } },
    'pool photo': { path: `/api/inspections/${INSPECTION_ID}/media/upload`, field: 'file', extra: {} },
} as const;

describe('photo upload routes decide the type from the bytes (real app)', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });

    it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])('%s: svg, html, zip, exe, webp, avif and an empty body are 400 and store nothing, whatever they are declared as', async (name) => {
        u = await createUploadHarness();
        const { path, field, extra } = ROUTES[name];
        for (const bytes of [SVG_BYTES, HTML_BYTES, ZIP_BYTES, EXE_BYTES, WEBP_BYTES, AVIF_BYTES, new Uint8Array(0)]) {
            for (const type of ['image/jpeg', 'image/svg+xml', 'text/html']) {
                const res = await u.call(path, { method: 'POST', body: form(field, type, bytes, extra) });
                expect(res.status, `${name} ${type}`).toBe(400);
            }
        }
        expect(u.r2.store.size).toBe(0);
        // Control: the same route takes a real jpeg.
        const ok = await u.call(path, { method: 'POST', body: form(field, 'image/jpeg', JPEG_BYTES, extra) });
        expect(ok.status, await ok.clone().text()).toBe(200);
        expect(u.r2.store.size).toBe(1);
    });

    it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])('%s: a refused file type answers the stable code UNSUPPORTED_PHOTO_TYPE, and another 400 does not', async (name) => {
        u = await createUploadHarness();
        const { path, field, extra } = ROUTES[name];
        const refused = await u.call(path, { method: 'POST', body: form(field, 'image/jpeg', HTML_BYTES, extra) });
        expect(refused.status).toBe(400);
        const refusedBody = (await refused.json()) as { success: boolean; error: { code: string } };
        expect(refusedBody.success).toBe(false);
        expect(refusedBody.error.code).toBe('UNSUPPORTED_PHOTO_TYPE');
        // Control: a different 400 (the form has no file at all) carries some other code.
        const noFile = await u.call(path, { method: 'POST', body: form('other', 'image/jpeg', JPEG_BYTES, extra) });
        expect(noFile.status).toBe(400);
        const noFileBody = (await noFile.json()) as { error: { code: string } };
        expect(noFileBody.error.code).not.toBe('UNSUPPORTED_PHOTO_TYPE');
        // Control: the same route still stores a real photo.
        const ok = await u.call(path, { method: 'POST', body: form(field, 'image/jpeg', JPEG_BYTES, extra) });
        expect(ok.status).toBe(200);
    });

    it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])('%s: an oversized photo is a 413 with the stable code PHOTO_TOO_LARGE, and nothing is stored', async (name) => {
        u = await createUploadHarness();
        const { path, field, extra } = ROUTES[name];
        const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
        big.set(JPEG_BYTES);
        const res = await u.call(path, { method: 'POST', body: form(field, 'image/jpeg', big as Uint8Array<ArrayBuffer>, extra) });
        expect(res.status).toBe(413);
        expect(((await res.json()) as { error: { code: string } }).error.code).toBe('PHOTO_TOO_LARGE');
        expect(u.r2.store.size).toBe(0);
        // Control: a refused type is a 400 with its own code, not the size one.
        const refused = await u.call(path, { method: 'POST', body: form(field, 'image/jpeg', HTML_BYTES, extra) });
        expect(refused.status).toBe(400);
        expect(((await refused.json()) as { error: { code: string } }).error.code).toBe('UNSUPPORTED_PHOTO_TYPE');
    });

    it.each(Object.keys(ROUTES) as (keyof typeof ROUTES)[])('%s: a png declared as jpeg is stored as png, an untyped heic as heic', async (name) => {
        u = await createUploadHarness();
        const { path, field, extra } = ROUTES[name];
        const cases: [Uint8Array<ArrayBuffer>, string, string, string][] = [
            [PNG_BYTES, 'image/jpeg', 'image/png', '.png'],
            [HEIC_BYTES, 'application/octet-stream', 'image/heic', '.heic'],
            [JPEG_BYTES, 'image/png', 'image/jpeg', '.jpg'],
        ];
        for (const [bytes, type, stored, ext] of cases) {
            u.r2.store.clear();
            const res = await u.call(path, { method: 'POST', body: form(field, type, bytes, extra) });
            expect(res.status, `${name} ${type}`).toBe(200);
            const [key, entry] = [...u.r2.store.entries()][0]!;
            expect(key.endsWith(ext), key).toBe(true);
            expect(entry.contentType).toBe(stored);
        }
    });

    it('profile photo: the bytes decide, html and svg declared as jpeg are refused, a png declared as jpeg is stored as png', async () => {
        u = await createUploadHarness();
        const path = '/api/profile/photo';
        for (const bytes of [SVG_BYTES, HTML_BYTES, ZIP_BYTES, AVIF_BYTES]) {
            expect((await u.call(path, { method: 'POST', body: form('photo', 'image/jpeg', bytes) })).status).toBe(400);
        }
        expect(u.r2.store.size).toBe(0);
        const ok = await u.call(path, { method: 'POST', body: form('photo', 'image/jpeg', PNG_BYTES) });
        expect(ok.status, await ok.clone().text()).toBe(200);
        const [key, entry] = [...u.r2.store.entries()][0]!;
        expect(key.endsWith('.png')).toBe(true);
        expect(entry.contentType).toBe('image/png');
    });
});
