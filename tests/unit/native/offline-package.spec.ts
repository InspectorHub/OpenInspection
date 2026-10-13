/**
 * The offline package format and the guards that run before any of it is
 * inflated. Every refusal is paired with a positive control (the same package
 * minus the fault is accepted) so a reader that rejects everything cannot pass.
 */
import { describe, it, expect } from 'vitest';
import { zipSync } from 'fflate';
import {
    OfflinePackageManifestSchema, OutboxEntrySchema, OutboxSchema, MediaIndexSchema, OFFLINE_ID_PATTERN,
} from '../../../server/lib/native/offline-package';
import {
    listPackage, readPackageEntry, readPackageBody, MAX_PACKAGE_BYTES, MAX_MEDIA_ENTRY_BYTES, MAX_PACKAGE_ENTRIES,
} from '../../../server/lib/native/offline-zip';
import { buildPackage } from '../helpers/offline-package-fixture';

const manifest = {
    format: 'openinspection-offline-package',
    version: 1,
    tenantId: 'tenant-1',
    deviceId: 'device-1',
    exportedBy: 'user-a',
    exportedAt: '2026-10-01T12:00:00.000Z',
    inspections: [{ id: 'insp-1', reportId: 'rep-1' }],
};

describe('offline package manifest', () => {
    it('accepts a valid manifest', () => {
        expect(OfflinePackageManifestSchema.safeParse(manifest).success).toBe(true);
    });

    it.each([
        ['version 2', { ...manifest, version: 2 }],
        ['another format', { ...manifest, format: 'something-else' }],
        ['no inspections', { ...manifest, inspections: [] }],
        ['a bad timestamp', { ...manifest, exportedAt: 'yesterday' }],
        ['a duplicate inspection', { ...manifest, inspections: [{ id: 'a', reportId: 'r' }, { id: 'a', reportId: 'r' }] }],
        ['a path-shaped inspection id', { ...manifest, inspections: [{ id: 'bad id/..', reportId: 'r' }] }],
        ['a path-shaped tenant id', { ...manifest, tenantId: '../other' }],
    ])('rejects %s', (_label, value) => {
        expect(OfflinePackageManifestSchema.safeParse(value).success).toBe(false);
    });

    it('ignores unknown manifest keys instead of failing (additive fields within version 1)', () => {
        const parsed = OfflinePackageManifestSchema.safeParse({ ...manifest, future: true });
        expect(parsed.success).toBe(true);
    });
});

describe('offline package ids', () => {
    it.each(['abc', 'a-b_c', '33333333-0000-4000-8000-000000000001', 'A'.repeat(64)])('accepts %s', (id) => {
        expect(OFFLINE_ID_PATTERN.test(id)).toBe(true);
    });
    it.each(['', 'bad id/..', 'a/b', 'a\\b', '..', 'a.b', 'a b', 'A'.repeat(65), 'a\nb'])('rejects %j', (id) => {
        expect(OFFLINE_ID_PATTERN.test(id)).toBe(false);
    });
});

describe('offline package outbox', () => {
    const entry = { idempotencyKey: 'k-1', op: 'inspection.create', payload: { id: 'insp-1', propertyAddress: '1 Main St' } };

    it('accepts the three registered operations', () => {
        for (const op of ['inspection.create', 'inspection.update', 'inspection.complete']) {
            expect(OutboxEntrySchema.safeParse({ ...entry, op }).success, op).toBe(true);
        }
    });

    it('rejects an operation outside the registry', () => {
        expect(OutboxEntrySchema.safeParse({ ...entry, op: 'inspection.delete' }).success).toBe(false);
        expect(OutboxEntrySchema.safeParse({ ...entry, op: 'tenant.update' }).success).toBe(false);
    });

    it('rejects an envelope with extra keys, a payload without an id, and header-unsafe keys', () => {
        expect(OutboxEntrySchema.safeParse({ ...entry, extra: 1 }).success).toBe(false);
        expect(OutboxEntrySchema.safeParse({ ...entry, payload: { propertyAddress: 'x' } }).success).toBe(false);
        expect(OutboxEntrySchema.safeParse({ ...entry, idempotencyKey: 'a\r\nX: y' }).success).toBe(false);
    });

    it('rejects a repeated idempotency key', () => {
        expect(OutboxSchema.safeParse([entry, entry]).success).toBe(false);
        expect(OutboxSchema.safeParse([entry, { ...entry, idempotencyKey: 'k-2' }]).success).toBe(true);
    });
});

describe('offline package media index', () => {
    it('accepts the three photo types and rejects others', () => {
        const row = { pendingId: 'p1', inspectionId: 'i1', contentType: 'image/jpeg' };
        expect(MediaIndexSchema.safeParse([row]).success).toBe(true);
        expect(MediaIndexSchema.safeParse([{ ...row, contentType: 'image/svg+xml' }]).success).toBe(false);
        expect(MediaIndexSchema.safeParse([{ ...row, pendingId: '../x' }]).success).toBe(false);
        expect(MediaIndexSchema.safeParse([row, row]).success).toBe(false);
    });
});

describe('offline package archive listing', () => {
    const good = (): Record<string, Uint8Array> => ({
        'manifest.json': new TextEncoder().encode('{}'),
        'outbox.json': new TextEncoder().encode('[]'),
        'media/index.json': new TextEncoder().encode('[]'),
        'yjs/insp-1.bin': new Uint8Array([1, 2, 3]),
        'media/p1.jpg': new Uint8Array([4, 5]),
    });

    it('lists a well-formed archive with the sizes it declares', () => {
        const listing = listPackage(zipSync(good()));
        expect(listing.ok).toBe(true);
        if (listing.ok) {
            expect([...listing.entries.keys()].sort()).toEqual(['manifest.json', 'media/index.json', 'media/p1.jpg', 'outbox.json', 'yjs/insp-1.bin']);
            expect(listing.entries.get('yjs/insp-1.bin')).toBe(3);
        }
    });

    it.each([
        ['a dot-dot segment', '../evil.json'],
        ['a nested dot-dot', 'media/../manifest.json'],
        ['an absolute path', '/manifest.json'],
        ['a backslash', 'yjs\\insp-1.bin'],
        ['a drive path', 'C:/manifest.json'],
        ['an unknown entry', 'notes.txt'],
        ['a directory entry', 'media/'],
        ['an unlisted photo type', 'media/p1.svg'],
        ['a nested yjs path', 'yjs/a/b.bin'],
        ['a different case', 'Manifest.json'],
    ])('refuses %s, and accepts the archive without it', (_label, name) => {
        const files = good();
        expect(listPackage(zipSync(files)).ok).toBe(true);
        files[name] = new Uint8Array([1]);
        expect(listPackage(zipSync(files)).ok).toBe(false);
    });

    it('refuses a repeated entry name', () => {
        // fflate will not write a duplicate, so rename one entry in place: the name sits in
        // both the local header and the central directory of the archive.
        const renamed = zipSync({ 'yjs/aaaa.bin': new Uint8Array([1]), 'yjs/bbbb.bin': new Uint8Array([2]) });
        const text = new TextDecoder('latin1').decode(renamed);
        let at = text.indexOf('bbbb');
        expect(at).toBeGreaterThan(-1);
        while (at !== -1) {
            renamed.set(new TextEncoder().encode('aaaa'), at);
            at = text.indexOf('bbbb', at + 1);
        }
        const listing = listPackage(renamed);
        expect(listing.ok).toBe(false);
        if (!listing.ok) expect(listing.reason).toMatch(/duplicate/);
    });

    it('refuses garbage that is not a zip', () => {
        const listing = listPackage(new TextEncoder().encode('this is not a zip archive at all, just text'));
        expect(listing.ok).toBe(false);
    });

    it('refuses a compression bomb from its declared size, before inflating it', () => {
        // 20 MiB of zeros deflates to a few kilobytes; the entry limit for a photo is 10 MiB.
        const bomb = new Uint8Array(MAX_MEDIA_ENTRY_BYTES * 2);
        const zip = zipSync({ 'manifest.json': new Uint8Array([123, 125]), 'media/p1.jpg': [bomb, { level: 9 }] });
        expect(zip.byteLength).toBeLessThan(100 * 1024);
        const listing = listPackage(zip);
        expect(listing.ok).toBe(false);
        if (!listing.ok) expect(listing.reason).toMatch(/too large/);
        // Positive control: the same shape, exactly at the entry limit, is accepted.
        const fits = zipSync({ 'media/p1.jpg': [new Uint8Array(MAX_MEDIA_ENTRY_BYTES), { level: 9 }] });
        expect(listPackage(fits).ok).toBe(true);
    });

    it('refuses an entry whose directory entry declares a huge size, without inflating', () => {
        const zip = zipSync({ 'media/p1.jpg': new Uint8Array(1000) });
        const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
        let cd = -1;
        for (let i = zip.length - 22; i >= 0; i--) if (view.getUint32(i, true) === 0x02014b50) { cd = i; break; }
        expect(cd).toBeGreaterThan(0);
        expect(listPackage(zip).ok).toBe(true);
        view.setUint32(cd + 24, 500 * 1024 * 1024, true);
        expect(listPackage(zip).ok).toBe(false);
    });

    it('refuses a package whose entries add up to too much once unpacked', () => {
        const files: Record<string, Uint8Array> = {};
        // Nine photos just under the per-entry limit: each is fine, together they are not.
        for (let i = 0; i < 9; i++) files[`media/p${i}.jpg`] = new Uint8Array(MAX_MEDIA_ENTRY_BYTES - 1024);
        const listing = listPackage(zipSync(files, { level: 9 }));
        expect(listing.ok).toBe(false);
        if (!listing.ok) expect(listing.reason).toMatch(/unpacked/);
    });

    it('refuses too many entries', () => {
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < MAX_PACKAGE_ENTRIES + 1; i++) files[`yjs/i${i}.bin`] = new Uint8Array(1);
        expect(listPackage(zipSync(files)).ok).toBe(false);
    });

    it('reads an entry back at its declared size, and not as another size', () => {
        const zip = zipSync(good());
        expect(readPackageEntry(zip, 'yjs/insp-1.bin', 3)).toEqual(new Uint8Array([1, 2, 3]));
        expect(readPackageEntry(zip, 'yjs/insp-1.bin', 4)).toBeNull();
        expect(readPackageEntry(zip, 'yjs/absent.bin', 3)).toBeNull();
    });

    it('lists a package built the way the import specs build one', () => {
        const zip = buildPackage({
            tenantId: 't', inspections: [{ id: 'insp-1', reportId: 'r' }], yjs: { 'insp-1': new Uint8Array([1]) },
            media: [{ pendingId: 'p1', inspectionId: 'insp-1', contentType: 'image/png' }],
        });
        const listing = listPackage(zip);
        expect(listing.ok).toBe(true);
        if (listing.ok) expect(listing.entries.has('media/p1.png')).toBe(true);
    });
});

describe('offline package request body', () => {
    const req = (length: string | undefined, body: Uint8Array): Request => {
        const headers = new Headers();
        if (length !== undefined) headers.set('content-length', length);
        return new Request('http://x/api/client/import', { method: 'POST', headers, body: new Uint8Array(body) });
    };

    it('reads a body whose length matches its declaration', async () => {
        const out = await readPackageBody(req('3', new Uint8Array([1, 2, 3])));
        expect(out).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    });

    it('answers 411 without a declared length, 413 over the cap, 400 for a malformed or false one', async () => {
        const noLength = new Request('http://x/', { method: 'POST', body: new Uint8Array([1]) });
        noLength.headers.delete('content-length');
        expect(await readPackageBody(noLength)).toEqual({ ok: false, status: 411 });
        expect(await readPackageBody(req(String(MAX_PACKAGE_BYTES + 1), new Uint8Array([1])))).toEqual({ ok: false, status: 413 });
        expect(await readPackageBody(req('12abc', new Uint8Array([1])))).toEqual({ ok: false, status: 400 });
        // Declared shorter than sent, and declared longer than sent.
        expect(await readPackageBody(req('2', new Uint8Array([1, 2, 3])))).toEqual({ ok: false, status: 400 });
        expect(await readPackageBody(req('5', new Uint8Array([1, 2, 3])))).toEqual({ ok: false, status: 400 });
    });
});
