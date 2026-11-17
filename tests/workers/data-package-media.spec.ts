/**
 * E-2 media service against REAL (miniflare) R2.
 *
 * The node-side spec proves the service logic over a mock bucket. This one
 * proves what only workerd can: that an RFC 9110 Range over a real R2 object
 * returns exactly the requested bytes with the right 206/416/200 semantics,
 * that Content-Range/ETag survive the real binding, and that a traversal or
 * cross-tenant key never reads an object. No D1 or job token is involved —
 * the service takes an already-verified tenant id and a bucket.
 */
import { env as testEnv } from 'cloudflare:test';
import { describe, it, expect, beforeEach } from 'vitest';
import { DataPackageMediaService } from '../../server/services/data-package/media.service';

const b = testEnv as unknown as { PHOTOS: R2Bucket };
const TENANT = 'dp-media-tenant';
const OTHER = 'dp-media-other';

const bytes = (text: string) => new TextEncoder().encode(text);

async function seed(key: string, text: string, contentType = 'application/octet-stream') {
    await b.PHOTOS.put(key, bytes(text), { httpMetadata: { contentType } });
}

beforeEach(async () => {
    // Remove only the keys this suite owns (miniflare buckets persist across tests in a run).
    for (const prefix of [`${TENANT}/`, `${OTHER}/`]) {
        const listed = await b.PHOTOS.list({ prefix });
        if (listed.objects.length) await b.PHOTOS.delete(listed.objects.map((o) => o.key));
    }
});

describe('DataPackageMediaService on real R2', () => {
    it('streams a whole object with the real ETag and no-store', async () => {
        await seed(`${TENANT}/media/clip.bin`, '0123456789');
        const svc = new DataPackageMediaService(b.PHOTOS);
        const res = await svc.open(TENANT, 'media/clip.bin', undefined);
        expect(res).not.toBeNull();
        expect(res!.status).toBe(200);
        expect(res!.headers.get('Content-Length')).toBe('10');
        expect(res!.headers.get('Accept-Ranges')).toBe('bytes');
        expect(res!.headers.get('Cache-Control')).toBe('no-store');
        expect(res!.headers.get('ETag')).toBeTruthy();
        expect(await new Response(res!.body).text()).toBe('0123456789');
    });

    it('returns exactly the requested slice for a 206 against real R2', async () => {
        await seed(`${TENANT}/media/clip.bin`, '0123456789');
        const svc = new DataPackageMediaService(b.PHOTOS);
        const res = await svc.open(TENANT, 'media/clip.bin', 'bytes=2-5');
        expect(res!.status).toBe(206);
        expect(res!.headers.get('Content-Range')).toBe('bytes 2-5/10');
        expect(res!.headers.get('Content-Length')).toBe('4');
        expect(await new Response(res!.body).text()).toBe('2345');
    });

    it('serves open-ended and suffix ranges over real R2', async () => {
        await seed(`${TENANT}/media/clip.bin`, '0123456789');
        const svc = new DataPackageMediaService(b.PHOTOS);
        const open = await svc.open(TENANT, 'media/clip.bin', 'bytes=7-');
        expect(open!.status).toBe(206);
        expect(await new Response(open!.body).text()).toBe('789');
        const suffix = await svc.open(TENANT, 'media/clip.bin', 'bytes=-3');
        expect(suffix!.status).toBe(206);
        expect(await new Response(suffix!.body).text()).toBe('789');
    });

    it('returns 416 with no bytes for an unsatisfiable range against real R2', async () => {
        await seed(`${TENANT}/media/clip.bin`, '0123456789');
        const svc = new DataPackageMediaService(b.PHOTOS);
        const res = await svc.open(TENANT, 'media/clip.bin', 'bytes=99-');
        expect(res!.status).toBe(416);
        expect(res!.headers.get('Content-Range')).toBe('bytes */10');
        expect(res!.body).toBeNull();
    });

    it('never reads a traversal, excluded or cross-tenant key from real R2', async () => {
        await seed(`${TENANT}/media/ok.bin`, 'mine');
        await seed(`${OTHER}/media/secret.bin`, 'theirs');
        await seed(`${TENANT}/exports/secret.bin`, 'export-secret');
        const svc = new DataPackageMediaService(b.PHOTOS);
        for (const key of ['../dp-media-other/media/secret.bin', 'exports/secret.bin', '/abs.bin', 'a\\b.bin', 'a/../b.bin']) {
            expect(await svc.open(TENANT, key, undefined), key).toBeNull();
        }
        // A full other-tenant key is treated as a relative key under our prefix
        // and resolves to nothing — never to tenant-b's object.
        expect(await svc.open(TENANT, `${OTHER}/media/secret.bin`, undefined)).toBeNull();
        // A safe key still reads.
        const ok = await svc.open(TENANT, 'media/ok.bin', undefined);
        expect(await new Response(ok!.body).text()).toBe('mine');
    });

    it('lists tenant media with inferred kinds, excluding platform prefixes', async () => {
        await seed(`${TENANT}/media/photo.jpg`, 'jpg', 'image/jpeg');
        await seed(`${TENANT}/media/clip.mp4`, 'mp4', 'video/mp4');
        await seed(`${TENANT}/exports/secret.zip`, 'z', 'application/zip');
        await seed(`${OTHER}/media/foreign.jpg`, 'f', 'image/jpeg');
        const svc = new DataPackageMediaService(b.PHOTOS);
        const page = await svc.list(TENANT);
        const byKey = new Map(page.objects.map((o) => [o.key, o]));
        const photo = byKey.get('media/photo.jpg')!;
        // contentType + uploaded prove `include: ['httpMetadata']` took effect
        // on the REAL R2 listing (the node mock never exercised this).
        expect(photo.kind).toBe('image');
        expect(photo.contentType).toBe('image/jpeg');
        expect(photo.uploaded).toBeGreaterThan(0);
        expect(byKey.get('media/clip.mp4')?.kind).toBe('video');
        expect(byKey.has('exports/secret.zip')).toBe(false);
        expect([...byKey.keys()].some((k) => k.includes('foreign'))).toBe(false);
    });
});
