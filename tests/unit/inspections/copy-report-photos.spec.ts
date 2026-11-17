/**
 * The photo copy engine behind "copy as a new report": new objects under the new report's prefix, the
 * source never touched, a run repeated over the same plan, and a failure leaving nothing behind.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { CALLS_PER_OBJECT, copyPhotoEntries, MAX_STORAGE_CALLS_PER_RUN, type PhotoCopyPlan } from '../../../server/services/inspection/copy-report-photos';
import { makeMemoryR2, type MemoryR2 } from '../helpers/memory-r2';

const T = 'tenant-1';
const SRC = 'src-insp';
const NEW = 'new-insp';
const plan: PhotoCopyPlan = { tenantId: T, sourceInspectionId: SRC, targetInspectionId: NEW };
const srcKey = (name: string) => `${T}/inspections/${SRC}/photos/${name}`;
const newPrefix = `${T}/inspections/${NEW}/photos/`;
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const bytesOf = (seed: number) => Uint8Array.from({ length: 4096 }, (_, i) => (i * 31 + seed) % 256);

describe('copyPhotoEntries', () => {
    let r2: MemoryR2;
    beforeEach(() => { r2 = makeMemoryR2(); });

    it('copies the bytes (sha256 equal) to keys under the NEW prefix and leaves the source untouched', async () => {
        r2.seed(srcKey('m1.jpg'), bytesOf(1));
        r2.seed(srcKey('m1.cropped.jpg'), bytesOf(2));
        r2.seed(srcKey('m1.annotated.png'), bytesOf(3), 'image/png');
        const before = new Map([...r2.store].map(([k, o]) => [k, sha(o.bytes)]));

        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m1.jpg'), croppedKey: srcKey('m1.cropped.jpg'), annotatedKey: srcKey('m1.annotated.png'), mediaId: 'm1' }]);

        expect(out).toMatchObject({ copied: 1, failed: 0, skipped: 0, deferred: 0 });
        const copy = [...out.copies.values()][0]!;
        for (const [fromKey, toKey] of [[srcKey('m1.jpg'), copy.key], [srcKey('m1.cropped.jpg'), copy.croppedKey!], [srcKey('m1.annotated.png'), copy.annotatedKey!]] as const) {
            expect(toKey.startsWith(newPrefix)).toBe(true);
            expect(sha(r2.store.get(toKey)!.bytes)).toBe(sha(r2.store.get(fromKey)!.bytes));
            expect(r2.store.get(toKey)!.contentType).toBe(r2.store.get(fromKey)!.contentType);
        }
        expect(copy.key.endsWith('.jpg')).toBe(true);
        expect(copy.croppedKey).toMatch(/\.cropped\.jpg$/);
        expect(copy.annotatedKey).toMatch(/\.annotated\.png$/);
        expect(copy.mediaId).toBeTruthy();
        expect(copy.mediaId).not.toBe('m1');
        // The source objects are exactly as they were, and nothing was written or deleted under its prefix.
        for (const [k, h] of before) expect(sha(r2.store.get(k)!.bytes)).toBe(h);
        expect(r2.log.filter((l) => /^(put|delete):/.test(l) && l.includes(`/${SRC}/`))).toEqual([]);
    });

    it('the copy stays readable after the source objects are deleted (nothing is shared)', async () => {
        r2.seed(srcKey('m1.jpg'), bytesOf(7));
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m1.jpg') }]);
        const copyKey = [...out.copies.values()][0]!.key;
        await r2.bucket.delete(srcKey('m1.jpg'));
        expect(sha(r2.store.get(copyKey)!.bytes)).toBe(sha(bytesOf(7)));
    });

    it('running the same plan again lands on the same keys: no duplicates, and photos already there are not written again', async () => {
        for (let i = 0; i < 5; i++) r2.seed(srcKey(`m${i}.jpg`), bytesOf(i));
        const entries = Array.from({ length: 5 }, (_, i) => ({ key: srcKey(`m${i}.jpg`) }));

        const first = await copyPhotoEntries(r2.bucket, { ...plan, maxCalls: 2 * CALLS_PER_OBJECT }, entries);
        expect(first).toMatchObject({ copied: 2, deferred: 3 });
        const afterFirst = r2.keys(newPrefix);
        expect(afterFirst).toHaveLength(2);

        r2.log.length = 0;
        const second = await copyPhotoEntries(r2.bucket, plan, entries);
        expect(second).toMatchObject({ copied: 5, failed: 0, deferred: 0 });
        expect(r2.keys(newPrefix)).toHaveLength(5);
        for (const k of afterFirst) expect(r2.keys(newPrefix)).toContain(k);
        // The two finished earlier were recognised and not written a second time.
        const rewritten = r2.log.filter((l) => l.startsWith('put:') && afterFirst.includes(l.slice(4)));
        expect(rewritten).toEqual([]);
    });

    it('a photo whose copy fails is removed completely and not linked; the others still copy; no orphan is left', async () => {
        r2.seed(srcKey('ok.jpg'), bytesOf(1));
        r2.seed(srcKey('bad.jpg'), bytesOf(2));
        r2.seed(srcKey('bad.cropped.jpg'), bytesOf(3));
        // The destination key is derived, so learn it from a dry run on a scratch bucket, then break exactly that write.
        const scratch = makeMemoryR2();
        scratch.seed(srcKey('bad.jpg'), 'x');
        const badKey = [...(await copyPhotoEntries(scratch.bucket, plan, [{ key: srcKey('bad.jpg') }])).copies.values()][0]!.key;
        r2.failPut = (key) => key === badKey;

        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('ok.jpg') }, { key: srcKey('bad.jpg'), croppedKey: srcKey('bad.cropped.jpg') }]);

        expect(out).toMatchObject({ copied: 1, failed: 1 });
        expect(out.copies.size).toBe(1);
        expect(r2.keys(newPrefix)).toHaveLength(1);
        expect(r2.keys(newPrefix)).not.toContain(badKey);
    });

    it('an object that lands short is removed, counted as failed and not linked', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        r2.shortPut = (key) => key.startsWith(newPrefix);
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg') }]);
        expect(out).toMatchObject({ copied: 0, failed: 1 });
        expect(out.copies.size).toBe(0);
        expect(r2.keys(newPrefix)).toEqual([]);
    });

    it('a failed copy costs five calls per object at most (two heads, get, put, and the delete that removes it): the budget count is the real worst case', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        r2.failPut = (k) => k.startsWith(newPrefix);
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg') }]);
        expect(out.failed).toBe(1);
        expect(r2.log.map((l) => l.split(':')[0])).toEqual(['head', 'head', 'get', 'put', 'delete']);
        expect(r2.log).toHaveLength(CALLS_PER_OBJECT);
    });

    it('the budget binds the first photo too: a photo whose objects cost more than the whole budget is deferred, not let through', async () => {
        r2.seed(srcKey('m.jpg'), 'x');
        const entries = Array.from({ length: 4 }, (_, i) => {
            return { key: srcKey('m.jpg'), croppedKey: srcKey(`m.cropped.${'0123456789abcdef'.slice(i, i + 8).padEnd(8, '0')}.jpg`), annotatedKey: srcKey(`m.annotated.${'fedcba9876543210'.slice(i, i + 8).padEnd(8, '0')}.png`) };
        });
        for (const e of entries) { r2.seed(e.croppedKey, 'c'); r2.seed(e.annotatedKey, 'a'); }
        const out = await copyPhotoEntries(r2.bucket, plan, entries);
        expect(out).toMatchObject({ copied: 0, deferred: 4 });
        expect(r2.log).toEqual([]);
    });

    it('a photo-like entry outside the photos folder (an older key layout) is unsupported, not silently complete', async () => {
        const legacy = `${T}/${SRC}/photos/old.jpg`;
        r2.seed(legacy, 'x');
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: legacy }]);
        expect(out).toMatchObject({ copied: 0, skipped: 1, unsupported: 1 });
        expect(r2.log).toEqual([]);
    });

    it('videos and pending uploads are skipped but are not "unsupported"', async () => {
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('v.mp4'), mediaType: 'video' }, { key: srcKey('p.jpg'), pendingUpload: true }]);
        expect(out).toMatchObject({ skipped: 2, unsupported: 0 });
    });

    it('baked variants that are refused, missing or failed are counted as dropped, once per entry', async () => {
        r2.seed(srcKey('a.jpg'), 'x'); r2.seed(srcKey('b.jpg'), 'x'); r2.seed(srcKey('c.jpg'), 'x'); r2.seed(srcKey('c.cropped.jpg'), 'v');
        r2.failPut = (k) => k.includes('.cropped.');
        const out = await copyPhotoEntries(r2.bucket, plan, [
            { key: srcKey('a.jpg'), croppedKey: `${T}/inspections/${SRC}/cover/a.cropped.jpg` }, // refused: another folder
            { key: srcKey('b.jpg'), croppedKey: srcKey('b.cropped.jpg') },                         // missing
            { key: srcKey('c.jpg'), croppedKey: srcKey('c.cropped.jpg') },                         // write fails
        ]);
        expect(out).toMatchObject({ copied: 3, failed: 0, droppedVariants: 3 });
    });

    it('only the content type travels: a stored file name is not carried onto the copy', async () => {
        r2.seed(srcKey('m.jpg'), 'x', 'image/jpeg', 'attachment; filename="Smith family front.jpg"');
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg') }]);
        const copy = r2.store.get([...out.copies.values()][0]!.key)!;
        expect(copy.contentType).toBe('image/jpeg');
        expect(copy.contentDisposition).toBeUndefined();
    });

    it('a failed baked variant costs the variant, not the photo, and leaves no object for it', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        r2.seed(srcKey('m.cropped.jpg'), bytesOf(2));
        r2.failPut = (key) => key.includes('.cropped.');
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg'), croppedKey: srcKey('m.cropped.jpg') }]);
        const copy = [...out.copies.values()][0]!;
        expect(out).toMatchObject({ copied: 1, failed: 0 });
        expect(copy.croppedKey).toBeUndefined();
        expect(r2.keys(newPrefix)).toEqual([copy.key]);
    });

    it('a source photo that is missing fails that photo and writes nothing for it', async () => {
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('gone.jpg') }]);
        expect(out).toMatchObject({ copied: 0, failed: 1 });
        expect(r2.keys()).toEqual([]);
    });

    it('never reads a key outside the source report: another report or another company is skipped, not copied', async () => {
        const foreignTenant = `other-tenant/inspections/${SRC}/photos/x.jpg`;
        const otherReport = `${T}/inspections/someone-else/photos/y.jpg`;
        const traversal = `${T}/inspections/${SRC}/../someone-else/photos/z.jpg`;
        for (const k of [foreignTenant, otherReport, traversal]) r2.seed(k, bytesOf(9));
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: foreignTenant }, { key: otherReport }, { key: traversal }]);
        expect(out).toMatchObject({ copied: 0, skipped: 3 });
        expect(r2.log.filter((l) => /^(get|head|put):/.test(l))).toEqual([]);
        expect(r2.keys(newPrefix)).toEqual([]);
    });

    it('a variant key outside the source report is ignored while the photo itself copies', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        r2.seed(`other-tenant/inspections/${SRC}/photos/m.cropped.jpg`, bytesOf(5));
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg'), croppedKey: `other-tenant/inspections/${SRC}/photos/m.cropped.jpg` }]);
        expect(out.copied).toBe(1);
        expect([...out.copies.values()][0]!.croppedKey).toBeUndefined();
        expect(r2.log.some((l) => l.includes('other-tenant'))).toBe(false);
    });

    it('videos, uploads still waiting on a device and empty keys are skipped and counted', async () => {
        r2.seed(srcKey('v.mp4'), bytesOf(1), 'video/mp4');
        const out = await copyPhotoEntries(r2.bucket, plan, [
            { key: srcKey('v.mp4'), mediaType: 'video', provider: 'r2' },
            { key: '', pendingUpload: true, pendingId: 'p1' },
            { key: srcKey('v.mp4'), pendingUpload: true },
        ]);
        expect(out).toMatchObject({ copied: 0, skipped: 3, failed: 0 });
        expect(r2.keys(newPrefix)).toEqual([]);
    });

    it('is bounded by a storage-call budget: what does not fit is deferred, and the calls spent stay inside the budget', async () => {
        const fits = Math.floor(MAX_STORAGE_CALLS_PER_RUN / CALLS_PER_OBJECT);
        const entries = Array.from({ length: fits + 3 }, (_, i) => { r2.seed(srcKey(`m${i}.jpg`), 'x'); return { key: srcKey(`m${i}.jpg`) }; });
        const out = await copyPhotoEntries(r2.bucket, plan, entries);
        expect(out).toMatchObject({ copied: fits, deferred: 3 });
        expect(r2.keys(newPrefix)).toHaveLength(fits);
        expect(r2.log.length).toBeLessThanOrEqual(MAX_STORAGE_CALLS_PER_RUN);
    });

    it('a photo with baked variants costs one object call set per object, so fewer of them fit', async () => {
        for (let i = 0; i < 4; i++) { r2.seed(srcKey(`m${i}.jpg`), 'x'); r2.seed(srcKey(`m${i}.cropped.jpg`), 'y'); r2.seed(srcKey(`m${i}.annotated.png`), 'z'); }
        const entries = Array.from({ length: 4 }, (_, i) => ({ key: srcKey(`m${i}.jpg`), croppedKey: srcKey(`m${i}.cropped.jpg`), annotatedKey: srcKey(`m${i}.annotated.png`) }));
        const out = await copyPhotoEntries(r2.bucket, plan, entries);
        expect(out.copied).toBe(Math.floor(MAX_STORAGE_CALLS_PER_RUN / (3 * CALLS_PER_OBJECT)));
        expect(out.deferred).toBe(4 - out.copied);
        expect(r2.log.length).toBeLessThanOrEqual(MAX_STORAGE_CALLS_PER_RUN);
    });

    it.each(['agreements/env-1/signed.pdf', 'documents/d1-report.jpg', 'cover/c1.jpg', 'exports/e1.jpg', 'videos/v1.jpg', 'photos/sub/nested.jpg'])(
        'a file in a sibling folder of the photos (%s) is never read, even when its name looks like an image',
        async (rest) => {
            const key = `${T}/inspections/${SRC}/${rest}`;
            r2.seed(key, 'CANARY-NOT-A-PHOTO');
            const out = await copyPhotoEntries(r2.bucket, plan, [{ key }, { key: srcKey('ok.jpg'), croppedKey: key }]);
            expect(out.skipped).toBe(1);
            expect(r2.log.some((l) => l.includes(rest))).toBe(false);
            expect(r2.keys(newPrefix).every((k) => new TextDecoder().decode(r2.store.get(k)!.bytes) !== 'CANARY-NOT-A-PHOTO')).toBe(true);
        });

    it('a name outside the photo family inside the photos folder is skipped too (a pdf, a name with extra dots)', async () => {
        for (const n of ['report.pdf', 'a.b.c.jpg', 'x.annotated.gif']) r2.seed(srcKey(n), 'x');
        const out = await copyPhotoEntries(r2.bucket, plan, ['report.pdf', 'a.b.c.jpg', 'x.annotated.gif'].map((n) => ({ key: srcKey(n) })));
        expect(out).toMatchObject({ copied: 0, skipped: 3 });
    });

    it('entries that share one source key but differ in variants share one destination object; one failing variant does not delete it', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        r2.seed(srcKey('m.cropped.jpg'), bytesOf(2));
        r2.seed(srcKey('m.annotated.png'), bytesOf(3), 'image/png');
        r2.failPut = (k) => k.includes('.annotated.');
        const out = await copyPhotoEntries(r2.bucket, plan, [
            { key: srcKey('m.jpg'), croppedKey: srcKey('m.cropped.jpg') },
            { key: srcKey('m.jpg'), annotatedKey: srcKey('m.annotated.png') },
        ]);
        const [a, b] = [...out.copies.values()];
        expect(out.copied).toBe(2);
        expect(a!.key).toBe(b!.key);
        expect(r2.store.has(a!.key)).toBe(true);
        expect(a!.croppedKey).toBeTruthy();
        expect(b!.annotatedKey).toBeUndefined();
    });

    it('the same photo used twice is copied once and both uses map to it', async () => {
        r2.seed(srcKey('m.jpg'), bytesOf(1));
        const out = await copyPhotoEntries(r2.bucket, plan, [{ key: srcKey('m.jpg') }, { key: srcKey('m.jpg') }]);
        expect(out.copied).toBe(1);
        expect(r2.keys(newPrefix)).toHaveLength(1);
    });
});
