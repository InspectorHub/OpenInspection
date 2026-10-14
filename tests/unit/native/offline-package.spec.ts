/**
 * The offline package format and the guards that run before any of it is
 * inflated. Every refusal is paired with a positive control (the same package
 * minus the fault is accepted) so a reader that rejects everything cannot pass.
 */
import { describe, it, expect, vi } from 'vitest';
import { zipSync } from 'fflate';
import {
    OfflinePackageManifestSchema, OutboxEntrySchema, OutboxSchema, MediaIndexSchema, OFFLINE_ID_PATTERN,
    PACKAGE_MAX_AGE_DAYS, APPLIED_RECORD_RETENTION_DAYS,
} from '../../../server/lib/native/offline-package';
import {
    listPackage, readPackageEntry, readPackageEntries, verifyPackageEntries, MAX_MEDIA_ENTRY_BYTES,
} from '../../../server/lib/native/offline-zip';
import { readBoundedBody } from '../../../server/lib/bounded-body';
import { DEFAULT_IMPORT_LIMITS, IMPORT_LIMIT_CEILINGS } from '../../../server/lib/native/import-limits';
import { aliasEntryData, buildPackage, declareEntrySize } from '../helpers/offline-package-fixture';

const MAX_PACKAGE_BYTES = DEFAULT_IMPORT_LIMITS.compressedBytes;

// Counts inflate passes. Every pass re-reads the zip's whole central directory, so the count is
// the cost of reading a package's entries, independent of how fast the machine is.
const passes = vi.hoisted(() => ({ count: 0 }));
vi.mock('fflate', async (importOriginal) => {
    const real = await importOriginal<typeof import('fflate')>();
    return { ...real, unzipSync: ((...args: Parameters<typeof real.unzipSync>) => { passes.count++; return real.unzipSync(...args); }) as typeof real.unzipSync };
});

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

describe('offline package age and record retention', () => {
    it('accepts any package a device can have kept for as long as the longest offline setting allows', () => {
        // offline_max_days tops out at 365 (server/lib/validations/admin/settings.ts).
        expect(PACKAGE_MAX_AGE_DAYS).toBeGreaterThan(365);
    });

    it('keeps an applied record longer than any package that could repeat it can still be imported', () => {
        expect(APPLIED_RECORD_RETENTION_DAYS).toBeGreaterThan(PACKAGE_MAX_AGE_DAYS);
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
        if (!listing.ok) {
            expect(listing.reason).toMatch(/unpacked/);
            expect(listing.exceeded).toMatchObject({ limit: 'uncompressedBytes', max: DEFAULT_IMPORT_LIMITS.uncompressedBytes });
        }
    });

    it('refuses more entries than the limit, reports how many there were, and accepts exactly the limit', () => {
        const limits = { entries: 20, uncompressedBytes: DEFAULT_IMPORT_LIMITS.uncompressedBytes };
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < 20; i++) files[`yjs/i${i}.bin`] = new Uint8Array(1);
        expect(listPackage(zipSync(files), limits).ok).toBe(true);
        files['yjs/i20.bin'] = new Uint8Array(1);
        files['yjs/i21.bin'] = new Uint8Array(1);
        const listing = listPackage(zipSync(files), limits);
        expect(listing.ok).toBe(false);
        if (!listing.ok) expect(listing.exceeded).toEqual({ limit: 'entries', max: 20, actual: 22 });
    });

    it('refuses more entries than the default limit when none is given', () => {
        const files: Record<string, Uint8Array> = {};
        for (let i = 0; i < DEFAULT_IMPORT_LIMITS.entries + 1; i++) files[`yjs/i${i}.bin`] = new Uint8Array(1);
        expect(listPackage(zipSync(files)).ok).toBe(false);
    });

    it('reads an entry back at its declared size, and not as another size', () => {
        const zip = zipSync(good());
        expect(readPackageEntry(zip, 'yjs/insp-1.bin', 3)).toEqual(new Uint8Array([1, 2, 3]));
        expect(readPackageEntry(zip, 'yjs/insp-1.bin', 4)).toBeNull();
        expect(readPackageEntry(zip, 'yjs/absent.bin', 3)).toBeNull();
    });

    it('reads many entries without re-reading the archive directory for each one', () => {
        const files: Record<string, Uint8Array> = { 'manifest.json': new Uint8Array([123, 125]) };
        for (let i = 0; i < 1500; i++) files[`media/p${i}.jpg`] = new Uint8Array([i % 251, 1, 2]);
        const zip = zipSync(files);
        // Reading cost is the point here, so the listing runs at the largest limits an operator can set.
        const listing = listPackage(zip, IMPORT_LIMIT_CEILINGS);
        expect(listing.ok).toBe(true);
        if (!listing.ok) return;
        const wanted = new Map([...listing.entries].filter(([name]) => name.startsWith('media/')));
        expect(wanted.size).toBe(1500);

        // Control: listing is a directory pass through fflate, and the counter sees it.
        expect(passes.count).toBeGreaterThan(0);
        passes.count = 0;
        let read = 0;
        for (const [name, bytes] of readPackageEntries(zip, wanted)) {
            expect(bytes, name).not.toBeNull();
            read++;
        }
        expect(read).toBe(1500);
        expect(passes.count).toBe(0);
        expect(readPackageEntry(zip, 'media/p7.jpg', 3)).toEqual(new Uint8Array([7, 1, 2]));
    });

    it('reads entries one at a time: large entries come back whole and in order', () => {
        const big = (seed: number) => Uint8Array.from({ length: 5 * 1024 * 1024 }, (_, i) => (i * 7 + seed) & 255);
        const zip = zipSync({ 'media/a.jpg': big(1), 'media/b.jpg': big(2), 'media/c.jpg': big(3) }, { level: 0 });
        const listing = listPackage(zip);
        expect(listing.ok).toBe(true);
        if (!listing.ok) return;
        const sizes: number[] = [];
        for (const [, bytes] of readPackageEntries(zip, listing.entries)) sizes.push(bytes?.byteLength ?? -1);
        expect(sizes).toEqual([5 * 1024 * 1024, 5 * 1024 * 1024, 5 * 1024 * 1024]);
    });

    describe('an entry whose directory understates its size', () => {
        const names = ['yjs/insp-1.bin', 'media/p1.jpg', 'outbox.json'];
        const actual = (): Uint8Array => Uint8Array.from({ length: 1000 }, (_, i) => (i * 31) & 255);

        it.each(names)('is refused, not truncated: %s', (name) => {
            const honest = zipSync({ [name]: actual() });
            // Positive control: the same package, declared accurately, is read in full and verifies.
            expect(readPackageEntry(honest, name, 1000)).toEqual(actual());
            expect(verifyPackageEntries(honest, new Map([[name, 1000]]))).toBeNull();

            // A lie that stays inside what an encoder could produce looks fine from the directory alone.
            const lying = declareEntrySize(honest, name, 900);
            expect(listPackage(lying).ok, 'the directory alone looks fine').toBe(true);
            expect(readPackageEntry(lying, name, 900)).toBeNull();
            expect(verifyPackageEntries(lying, new Map([[name, 900]]))).toBe(name);

            // A larger lie carries more compressed data than its declaration could need: refused by the directory itself.
            const absurd = declareEntrySize(honest, name, 10);
            const listing = listPackage(absurd);
            expect(listing.ok).toBe(false);
            if (!listing.ok) expect(listing.reason).toContain(name);
            expect(readPackageEntry(absurd, name, 10)).toBeNull();
            expect(verifyPackageEntries(absurd, new Map([[name, 10]]))).toBe(name);
        });

        it('is refused when it is one byte over, and when it is stored', () => {
            const oneOver = declareEntrySize(zipSync({ 'yjs/insp-1.bin': actual() }), 'yjs/insp-1.bin', 999);
            expect(readPackageEntry(oneOver, 'yjs/insp-1.bin', 999)).toBeNull();
            const stored = declareEntrySize(zipSync({ 'yjs/insp-1.bin': [actual(), { level: 0 }] }), 'yjs/insp-1.bin', 10);
            expect(readPackageEntry(stored, 'yjs/insp-1.bin', 10)).toBeNull();
            expect(verifyPackageEntries(stored, new Map([['yjs/insp-1.bin', 10]]))).toBe('yjs/insp-1.bin');
        });

        it('is refused when it overstates its size too, and an empty entry is still read', () => {
            const over = declareEntrySize(zipSync({ 'yjs/insp-1.bin': actual() }), 'yjs/insp-1.bin', 1001);
            expect(readPackageEntry(over, 'yjs/insp-1.bin', 1001)).toBeNull();
            const empty = zipSync({ 'outbox.json': new Uint8Array(0) });
            expect(readPackageEntry(empty, 'outbox.json', 0)).toEqual(new Uint8Array(0));
        });

        it('reports the first bad entry among many accurate ones', () => {
            const zip = declareEntrySize(zipSync({ 'yjs/a.bin': actual(), 'yjs/b.bin': actual(), 'yjs/c.bin': actual() }), 'yjs/b.bin', 900);
            const wanted = new Map([['yjs/a.bin', 1000], ['yjs/b.bin', 900], ['yjs/c.bin', 1000]]);
            expect(verifyPackageEntries(zip, wanted)).toBe('yjs/b.bin');
            expect(verifyPackageEntries(zip, new Map([['yjs/a.bin', 1000], ['yjs/c.bin', 1000]]))).toBeNull();
        });
    });

    describe('CPU spent on an entry is bounded by what it declares', () => {
        const MIB = 1024 * 1024;
        /** Wall time of `fn` in milliseconds. */
        const timed = <T>(fn: () => T): { value: T; ms: number } => {
            const start = performance.now();
            const value = fn();
            return { value, ms: performance.now() - start };
        };

        it('refuses an entry that declares 10 bytes and carries a 64 MiB zero stream, from the directory and at once (positive control: the honest entry)', () => {
            const honest = zipSync({ 'yjs/insp-1.bin': [new Uint8Array(64 * MIB), { level: 9 }] });
            expect(honest.byteLength, 'the bomb is small on the wire').toBeLessThan(200 * 1024);
            const bomb = declareEntrySize(honest, 'yjs/insp-1.bin', 10);

            const listed = timed(() => listPackage(bomb));
            expect(listed.value.ok).toBe(false);
            if (!listed.value.ok) expect(listed.value.reason).toMatch(/compressed data/);
            expect(listed.ms, 'refused without inflating anything').toBeLessThan(100);
            expect(timed(() => verifyPackageEntries(bomb, new Map([['yjs/insp-1.bin', 10]]))).ms).toBeLessThan(100);
            expect(readPackageEntry(bomb, 'yjs/insp-1.bin', 10)).toBeNull();

            // Control: the same stream declaring a size an encoder could have produced it from is not refused by the directory.
            expect(listPackage(declareEntrySize(honest, 'yjs/insp-1.bin', 100_000)).ok).toBe(true);
        });

        it('stops inflating an entry that declares about what it carries but expands a thousand-fold (positive control: the directory accepts it)', () => {
            // 128 MiB of zeros is ~130 KB compressed. Declaring 200 KB passes the directory checks,
            // and only the inflater can find out how much the stream really holds.
            const honest = zipSync({ 'yjs/insp-1.bin': [new Uint8Array(128 * MIB), { level: 9 }] });
            expect(honest.byteLength).toBeLessThan(200 * 1024);
            const bomb = declareEntrySize(honest, 'yjs/insp-1.bin', 200 * 1024);
            const wanted = new Map([['yjs/insp-1.bin', 200 * 1024]]);
            expect(listPackage(bomb).ok, 'the directory alone looks fine').toBe(true);

            const verified = timed(() => verifyPackageEntries(bomb, wanted));
            expect(verified.value).toBe('yjs/insp-1.bin');
            expect(verified.ms, 'abandoned as soon as it passes its declaration').toBeLessThan(100);
            const read = timed(() => readPackageEntry(bomb, 'yjs/insp-1.bin', 200 * 1024));
            expect(read.value).toBeNull();
            expect(read.ms).toBeLessThan(100);
        });

        it('still reads a legitimate entry that compresses about 1000:1 (declared size equals actual size)', () => {
            const zeros = new Uint8Array(MIB);
            const zip = zipSync({ 'yjs/insp-1.bin': [zeros, { level: 9 }] });
            expect(zip.byteLength).toBeLessThan(MIB / 500);
            expect(listPackage(zip).ok).toBe(true);
            expect(verifyPackageEntries(zip, new Map([['yjs/insp-1.bin', MIB]]))).toBeNull();
            const read = readPackageEntry(zip, 'yjs/insp-1.bin', MIB);
            expect(read?.byteLength).toBe(MIB);
            expect(read?.every((b) => b === 0)).toBe(true);
        });

        it('reads entries that do not compress at all (stored blocks) and a mix of both', () => {
            const noise = Uint8Array.from({ length: 300_000 }, (_, i) => (i * 2654435761) >>> 24);
            const zip = zipSync({ 'media/p1.jpg': noise, 'yjs/insp-1.bin': [noise, { level: 0 }], 'outbox.json': new TextEncoder().encode('[]') });
            const listing = listPackage(zip);
            expect(listing.ok).toBe(true);
            if (!listing.ok) return;
            expect(verifyPackageEntries(zip, listing.entries)).toBeNull();
            expect(readPackageEntry(zip, 'media/p1.jpg', 300_000)).toEqual(noise);
        });

        it('refuses a stored entry whose length differs from its declaration, from the directory', () => {
            const stored = zipSync({ 'yjs/insp-1.bin': [new Uint8Array(1000), { level: 0 }] });
            expect(listPackage(stored).ok).toBe(true);
            const listing = listPackage(declareEntrySize(stored, 'yjs/insp-1.bin', 999));
            expect(listing.ok).toBe(false);
            if (!listing.ok) expect(listing.reason).toMatch(/stored/);
        });

        it('refuses two entries that share compressed bytes (positive control: the same two entries apart)', () => {
            const content = new Uint8Array(4000);
            const apart = zipSync({ 'yjs/a.bin': [content, { level: 9 }], 'yjs/b.bin': [content, { level: 9 }] });
            expect(listPackage(apart).ok).toBe(true);
            expect(verifyPackageEntries(apart, new Map([['yjs/a.bin', 4000], ['yjs/b.bin', 4000]]))).toBeNull();

            const shared = aliasEntryData(apart, 'yjs/b.bin', 'yjs/a.bin');
            const listing = listPackage(shared);
            expect(listing.ok).toBe(false);
            if (!listing.ok) expect(listing.reason).toMatch(/shares compressed data/);
            // The readers every later step uses refuse it too, not only the listing.
            expect(verifyPackageEntries(shared, new Map([['yjs/b.bin', 4000]]))).toBe('yjs/b.bin');
            expect(readPackageEntry(shared, 'yjs/b.bin', 4000)).toBeNull();
        });
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
        const out = await readBoundedBody(req('3', new Uint8Array([1, 2, 3])), MAX_PACKAGE_BYTES, 400);
        expect(out).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3]) });
    });

    it('answers 411 without a declared length, 413 over the cap, 400 for a malformed or false one', async () => {
        const noLength = new Request('http://x/', { method: 'POST', body: new Uint8Array([1]) });
        noLength.headers.delete('content-length');
        expect(await readBoundedBody(noLength, MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 411 });
        expect(await readBoundedBody(req(String(MAX_PACKAGE_BYTES + 1), new Uint8Array([1])), MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 413 });
        expect(await readBoundedBody(req('12abc', new Uint8Array([1])), MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 400 });
        // Declared shorter than sent, and declared longer than sent.
        expect(await readBoundedBody(req('2', new Uint8Array([1, 2, 3])), MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 400 });
        expect(await readBoundedBody(req('5', new Uint8Array([1, 2, 3])), MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 400 });
    });

    it('does not reserve memory for a declared length that never arrives', async () => {
        const declared = MAX_PACKAGE_BYTES;
        let arrayBuffersWhilePending = 0;
        const baseline = process.memoryUsage().arrayBuffers;
        const slow = new ReadableStream<Uint8Array>({
            pull(controller) {
                // The reader is attached and waiting for the rest; whatever it reserved is live now.
                arrayBuffersWhilePending = process.memoryUsage().arrayBuffers;
                controller.close();
            },
            start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); },
        });
        const request = new Request('http://x/api/client/import', {
            method: 'POST', headers: { 'content-length': String(declared) }, body: slow, duplex: 'half',
        } as RequestInit);
        expect(await readBoundedBody(request, MAX_PACKAGE_BYTES, 400)).toEqual({ ok: false, status: 400 });
        // A 16 MiB pre-allocation would show up as ~24 MiB here; three bytes of body must not.
        expect(arrayBuffersWhilePending - baseline).toBeLessThan(4 * 1024 * 1024);
    });

    it('measures a real allocation the same way (positive control for the pre-allocation check above)', () => {
        const baseline = process.memoryUsage().arrayBuffers;
        const held = new Uint8Array(MAX_PACKAGE_BYTES);
        held[held.length - 1] = 1; // keep the buffer live and touched until the measurement
        const grown = process.memoryUsage().arrayBuffers - baseline;
        expect(held[held.length - 1]).toBe(1);
        expect(grown, 'the measurement must be able to see a 16 MiB buffer').toBeGreaterThan(4 * 1024 * 1024);
    });

    it('reads a body delivered in several chunks (positive control for the chunked path)', async () => {
        const parts = [new Uint8Array([1, 2]), new Uint8Array([3]), new Uint8Array([4, 5, 6])];
        const stream = new ReadableStream<Uint8Array>({
            start(controller) { for (const p of parts) controller.enqueue(p); controller.close(); },
        });
        const request = new Request('http://x/api/client/import', {
            method: 'POST', headers: { 'content-length': '6' }, body: stream, duplex: 'half',
        } as RequestInit);
        expect(await readBoundedBody(request, MAX_PACKAGE_BYTES, 400)).toEqual({ ok: true, bytes: new Uint8Array([1, 2, 3, 4, 5, 6]) });
    });
});
