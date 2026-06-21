// A-21 batch 3 — buildZipToR2 against REAL (miniflare) R2: streams photos from
// PHOTOS through a fflate streaming Zip into an EXPORTS_BUCKET multipart
// upload. A >8 MiB photo forces the multi-part path (parts must be EXACTLY
// equal-sized except the last — the R2 contract). The result is downloaded
// back and unzipped to prove integrity end-to-end.
//
// The D1 reads (inspections/templates/agreements) are stubbed via the same
// drizzle-orm/d1 module mock the node-side route tests use — declaring the
// full 30+-column DDL for three tables would test nothing this spec cares
// about.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';

// vi.mock factories are hoisted above module consts — vi.hoisted keeps the
// shared rows holder out of the TDZ when the factory runs at import time.
const fakeRows = vi.hoisted(() => ({ rows: [] as unknown[] }));
vi.mock('drizzle-orm/d1', () => ({
    drizzle: vi.fn(() => ({
        select: () => ({
            from: () => ({
                where: () => ({
                    all: async () => fakeRows.rows,
                }),
            }),
        }),
    })),
}));

import { DataExportService } from '../../server/services/data-export.service';

const b = env as unknown as { DB: D1Database; PHOTOS: R2Bucket; EXPORTS_BUCKET: R2Bucket };
const TENANT = 'stream-tenant-1';

function patternBytes(len: number, seed: number): Uint8Array {
    const out = new Uint8Array(len);
    for (let i = 0; i < len; i++) out[i] = (i * 31 + seed) & 0xff;
    return out;
}

/** Allocation-free byte equality — vitest's toEqual on multi-MiB typed arrays
 *  materializes diff structures and OOMs the workerd test heap. */
function sameBytes(a: Uint8Array | undefined, b: Uint8Array): boolean {
    if (!a || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
}

const PART = 5 * 1024 * 1024; // test part size = the R2 5 MiB floor

describe('DataExportService.buildZipToR2 — real R2 multipart streaming (A-21 batch 3)', () => {
    const small = patternBytes(64 * 1024, 1);          // 64 KiB
    const big = patternBytes(PART + 512 * 1024, 2);    // 5.5 MiB > PART → multiple parts

    beforeAll(async () => {
        fakeRows.rows = [{ id: 'i1', tenantId: TENANT }];
        // Keys use the new r2Keys convention: {tenantId}/{path} (no leading "tenants/" segment)
        await b.PHOTOS.put(`${TENANT}/insp1/a.jpg`, small);
        await b.PHOTOS.put(`${TENANT}/insp1/b.jpg`, big);
        await b.PHOTOS.put('OTHER/x.jpg', patternBytes(10, 3)); // prefix isolation
    });

    it('streams every photo (no byte budget), completes the multipart upload, and the ZIP round-trips', async () => {
        const svc = new DataExportService(b.DB, b.PHOTOS);
        const key = `exports/${TENANT}/test.zip`;
        const manifest = await svc.buildZipToR2(TENANT, b.EXPORTS_BUCKET, key, { partSizeBytes: PART });

        expect(manifest).toEqual({ rows: 1, photos: 2, photosEmbedded: 2 });

        const obj = await b.EXPORTS_BUCKET.get(key);
        expect(obj).not.toBeNull();
        const zipped = new Uint8Array(await obj!.arrayBuffer());
        // ZIP must be at least as large as the (stored, uncompressed) big photo
        // — and the big photo alone exceeds one part, proving multipart ran.
        expect(zipped.byteLength).toBeGreaterThan(PART);

        const entries = unzipSync(zipped);
        const names = Object.keys(entries).sort();
        expect(names).toEqual([
            'agreements.json',
            'inspections.csv',
            'photos-manifest.json',
            `photos/${TENANT}/insp1/a.jpg`,
            `photos/${TENANT}/insp1/b.jpg`,
            'README.txt',
            'templates.json',
        ].sort());
        // Byte-exact round-trip for both photos (pass-through = no recompression loss).
        expect(sameBytes(entries[`photos/${TENANT}/insp1/a.jpg`], small)).toBe(true);
        expect(sameBytes(entries[`photos/${TENANT}/insp1/b.jpg`], big)).toBe(true);
        // The other tenant's object never leaks in.
        expect(names.some((n) => n.includes('OTHER'))).toBe(false);
        // Manifest JSON marks both included.
        const manifestJson = JSON.parse(strFromU8(entries['photos-manifest.json']!)) as Array<{ included: boolean }>;
        expect(manifestJson).toHaveLength(2);
        expect(manifestJson.every((p) => p.included)).toBe(true);
    });
});
