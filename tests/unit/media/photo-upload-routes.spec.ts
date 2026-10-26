/**
 * The three image upload routes that take a file from the client (item photo, media-pool photo, profile photo),
 * through the REAL app: the declared type is not trusted, the bytes decide, and a refused file stores nothing.
 */
import { describe, it, expect, afterEach } from 'vitest';
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
