/**
 * E-2 media enumeration + Range download service tests.
 *
 * The desktop client lists tenant media and downloads each object in ranged
 * chunks. This service is the dumb-Worker boundary: it lists only the tenant
 * prefix (minus platform-owned prefixes), and streams an object with RFC 9110
 * Range semantics. The security invariants are the point of this spec:
 * a key that escapes the tenant prefix or lands in an excluded prefix must be
 * refused before any R2 call, and a bad Range must yield 416, never bytes.
 */
import { describe, it, expect } from 'vitest';
import { DataPackageMediaService } from '../../../server/services/data-package/media.service';

const TENANT = 'tenant-a';
const OTHER = 'tenant-b';

/**
 * Minimal R2Bucket mock that — unlike `memory-r2` — honours ranged `get` and
 * exposes `etag`/`uploaded`, the two fields the E-2 object path depends on.
 */
function makeMediaR2() {
    const store = new Map<string, { bytes: Uint8Array; contentType: string }>();
    const log: string[] = [];
    const meta = (key: string) => {
        const o = store.get(key)!;
        return {
            key, size: o.bytes.length, etag: `"etag-${key}"`, uploaded: new Date(1_700_000_000_000),
            httpMetadata: { contentType: o.contentType },
        };
    };
    const bucket = {
        head: async (key: string) => { log.push(`head:${key}`); return store.has(key) ? meta(key) : null; },
        get: async (key: string, opts?: { range?: { offset: number; length: number } }) => {
            log.push(`get:${key}`);
            const o = store.get(key);
            if (!o) return null;
            const bytes = opts?.range
                ? o.bytes.slice(opts.range.offset, opts.range.offset + opts.range.length)
                : o.bytes;
            return {
                ...meta(key), size: bytes.length,
                body: new Response(bytes.slice().buffer as ArrayBuffer).body,
                arrayBuffer: async () => bytes.slice().buffer,
            };
        },
        list: async (opts?: { prefix?: string; limit?: number; cursor?: string }) => {
            log.push(`list:${opts?.prefix ?? ''}`);
            const prefix = opts?.prefix ?? '';
            let keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
            if (opts?.cursor) keys = keys.filter((k) => k > opts.cursor!);
            const limit = opts?.limit ?? 1000;
            const page = keys.slice(0, limit);
            const truncated = keys.length > limit;
            return {
                objects: page.map(meta),
                truncated,
                cursor: truncated ? page[page.length - 1] : undefined,
                delimitedPrefixes: [],
            };
        },
    };
    return {
        bucket: bucket as unknown as R2Bucket,
        log,
        seed: (key: string, text: string, contentType = 'image/jpeg') => {
            store.set(key, { bytes: new TextEncoder().encode(text), contentType });
        },
    };
}

function listingBucket() {
    const r2 = makeMediaR2();
    r2.seed(`${TENANT}/inspections/i1/photos/a.jpg`, 'aaa', 'image/jpeg');
    r2.seed(`${TENANT}/inspections/i1/photos/b.jpg`, 'bbbb', 'image/jpeg');
    r2.seed(`${TENANT}/media/videos/clip.mp4`, '0123456789', 'video/mp4');
    // Excluded platform-owned prefixes must never surface.
    r2.seed(`${TENANT}/exports/2026/backup.zip`, 'secret-export', 'application/zip');
    r2.seed(`${TENANT}/migrations/001.sql`, 'secret-migration', 'text/plain');
    r2.seed(`${TENANT}/_platform/config.json`, 'secret-config', 'application/json');
    // Another tenant's object must never surface.
    r2.seed(`${OTHER}/inspections/x/photo.jpg`, 'other-tenant', 'image/jpeg');
    return r2;
}

describe('DataPackageMediaService.list', () => {
    it('lists only the tenant prefix, excluding platform-owned prefixes, with a relative key', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const page = await svc.list(TENANT);

        const keys = page.objects.map((o) => o.key);
        expect(keys).toContain('inspections/i1/photos/a.jpg');
        expect(keys).toContain('inspections/i1/photos/b.jpg');
        expect(keys).toContain('media/videos/clip.mp4');
        // Keys are relative to the tenant prefix (the client maps them to zip entries).
        expect(keys.every((k) => !k.startsWith(`${TENANT}/`))).toBe(true);
        // Excluded prefixes and the other tenant are absent.
        expect(keys.some((k) => k.startsWith('exports/'))).toBe(false);
        expect(keys.some((k) => k.startsWith('migrations/'))).toBe(false);
        expect(keys.some((k) => k.startsWith('_platform/'))).toBe(false);
        expect(keys.some((k) => k.includes('other-tenant'))).toBe(false);
        // Each object carries the bytes/size/etag/contentType the client needs.
        const a = page.objects.find((o) => o.key === 'inspections/i1/photos/a.jpg')!;
        expect(a.size).toBe(3);
        expect(a.contentType).toBe('image/jpeg');
        expect(typeof a.etag).toBe('string');
        expect(typeof a.uploaded).toBe('number');
    });

    it('paginates with an opaque cursor and never loses or repeats an object', async () => {
        const r2 = makeMediaR2();
        for (let i = 0; i < 5; i++) r2.seed(`${TENANT}/media/p${i}.jpg`, `v${i}`, 'image/jpeg');
        const svc = new DataPackageMediaService(r2.bucket);

        const seen: string[] = [];
        let cursor: string | null | undefined;
        do {
            const page = await svc.list(TENANT, cursor ?? undefined, 2);
            seen.push(...page.objects.map((o) => o.key));
            cursor = page.truncated ? page.cursor : null;
        } while (cursor);

        expect(seen.slice().sort()).toEqual([
            'media/p0.jpg', 'media/p1.jpg', 'media/p2.jpg', 'media/p3.jpg', 'media/p4.jpg',
        ]);
        expect(new Set(seen).size).toBe(seen.length);
    });

    it('follows the R2 cursor across multiple R2 pages, filtering excluded keys on every page', async () => {
        // The service asks R2 for up to 1000/page, but a mock that returns 2/page
        // forces the service's r2Cursor loop to run across several R2 pages.
        const objects = new Map<string, string>();
        for (let i = 0; i < 6; i++) objects.set(`${TENANT}/media/p${i}.jpg`, `v${i}`);
        objects.set(`${TENANT}/exports/x/secret.zip`, 'nope'); // excluded, must be dropped on its page
        const keys = () => [...objects.keys()].sort();
        const bucket = {
            list: async (o?: { prefix?: string; limit?: number; cursor?: string }) => {
                const all = keys().filter((k) => k.startsWith(o?.prefix ?? '') && (!o?.cursor || k > o.cursor));
                const page = all.slice(0, 2);
                const truncated = all.length > 2;
                return {
                    objects: page.map((k) => ({
                        key: k, size: 2, etag: 'e', uploaded: new Date(1_700_000_000_000), httpMetadata: { contentType: 'image/jpeg' },
                    })),
                    truncated, cursor: truncated ? page[page.length - 1] : undefined, delimitedPrefixes: [],
                };
            },
            head: async () => null, get: async () => null,
        } as unknown as R2Bucket;
        const svc = new DataPackageMediaService(bucket);
        const page = await svc.list(TENANT, undefined, 100);

        const seen = page.objects.map((o) => o.key);
        expect(seen).toEqual(['media/p0.jpg', 'media/p1.jpg', 'media/p2.jpg', 'media/p3.jpg', 'media/p4.jpg', 'media/p5.jpg']);
        expect(seen.some((k) => k.startsWith('exports/'))).toBe(false);
        expect(page.truncated).toBe(false);
    });

    it('skips a malformed cursor rather than throwing', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const page = await svc.list(TENANT, '!!not-a-cursor!!');
        expect(page.objects.length).toBeGreaterThan(0);
    });
});

describe('DataPackageMediaService.open', () => {
    it('opens a whole object with Accept-Ranges, ETag, Content-Length and no-store', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const res = await svc.open(TENANT, 'media/videos/clip.mp4', undefined);

        expect(res!.status).toBe(200);
        expect(res!.headers.get('Accept-Ranges')).toBe('bytes');
        expect(res!.headers.get('Cache-Control')).toBe('no-store');
        expect(res!.headers.get('ETag')).toBeTruthy();
        expect(res!.headers.get('Content-Length')).toBe('10');
        expect(await new Response(res!.body).text()).toBe('0123456789');
    });

    it('serves a satisfiable Range as a 206 with Content-Range and the exact slice', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const res = await svc.open(TENANT, 'media/videos/clip.mp4', 'bytes=2-5');

        expect(res!.status).toBe(206);
        expect(res!.headers.get('Content-Range')).toBe('bytes 2-5/10');
        expect(res!.headers.get('Content-Length')).toBe('4');
        expect(await new Response(res!.body).text()).toBe('2345');
    });

    it('serves an open-ended and a suffix Range correctly', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const open = await svc.open(TENANT, 'media/videos/clip.mp4', 'bytes=7-');
        expect(open!.status).toBe(206);
        expect(await new Response(open!.body).text()).toBe('789');

        const suffix = await svc.open(TENANT, 'media/videos/clip.mp4', 'bytes=-3');
        expect(suffix!.status).toBe(206);
        expect(await new Response(suffix!.body).text()).toBe('789');
    });

    it('returns 416 for an unsatisfiable Range, with no object bytes', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        const res = await svc.open(TENANT, 'media/videos/clip.mp4', 'bytes=99-');

        expect(res!.status).toBe(416);
        expect(res!.headers.get('Content-Range')).toBe('bytes */10');
        expect(res!.body).toBeNull();
        // A refused range never reaches R2.get.
        expect(r2.log.some((l) => l.startsWith('get:'))).toBe(false);
    });

    it('returns null for a missing object', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        expect(await svc.open(TENANT, 'media/missing.jpg', undefined)).toBeNull();
    });

    it('returns null when the object disappears between head and get (deletion race)', async () => {
        let headCalled = false;
        const racing = {
            head: async (key: string) => {
                headCalled = true;
                return { key, size: 10, etag: '"x"', uploaded: new Date(1_700_000_000_000), httpMetadata: { contentType: 'video/mp4' } };
            },
            get: async () => null, // object deleted between head and get
            list: async () => ({ objects: [], truncated: false, cursor: undefined, delimitedPrefixes: [] }),
        } as unknown as R2Bucket;
        const svc = new DataPackageMediaService(racing);
        expect(await svc.open(TENANT, 'media/videos/clip.mp4', undefined)).toBeNull();
        expect(headCalled).toBe(true);
    });

    it('refuses a key that escapes the tenant prefix before any R2 call', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        expect(await svc.open(TENANT, '../tenant-b/inspections/x/photo.jpg', undefined)).toBeNull();
        expect(r2.log.filter((l) => l.startsWith('head:') || l.startsWith('get:'))).toHaveLength(0);
    });

    it('refuses an absolute / backslashed / control-char key before any R2 call', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        for (const bad of ['/etc/passwd', 'a\\b\\c.jpg', 'a\u0000b.jpg', 'a/../b.jpg']) {
            expect(await svc.open(TENANT, bad, undefined), bad).toBeNull();
        }
        expect(r2.log.filter((l) => l.startsWith('head:') || l.startsWith('get:'))).toHaveLength(0);
    });

    it('refuses a key inside an excluded platform prefix', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        for (const bad of ['exports/2026/backup.zip', 'migrations/001.sql', '_platform/config.json']) {
            expect(await svc.open(TENANT, bad, undefined), bad).toBeNull();
        }
        expect(r2.log.filter((l) => l.startsWith('head:') || l.startsWith('get:'))).toHaveLength(0);
    });

    it('never reads another tenant\'s object, even when handed its full key', async () => {
        const r2 = listingBucket();
        const svc = new DataPackageMediaService(r2.bucket);
        // A caller smuggling the full cross-tenant key gets null: the service
        // unconditionally prefixes the VERIFIED tenant, so the lookup targets a
        // nonexistent `${TENANT}/${OTHER}/...` and can never read tenant-b's
        // bytes. Every R2 call stays under the verified tenant prefix.
        expect(await svc.open(TENANT, `${OTHER}/inspections/x/photo.jpg`, undefined)).toBeNull();
        const objectCalls = r2.log.filter((l) => l.startsWith('head:') || l.startsWith('get:'));
        expect(objectCalls.every((l) => l.slice(l.indexOf(':') + 1).startsWith(`${TENANT}/`))).toBe(true);
        expect(objectCalls.some((l) => l.includes('other-tenant'))).toBe(false);
    });
});
