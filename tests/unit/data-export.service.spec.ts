/**
 * DataExportService.buildZip — offboarding export must include PHOTO BYTES
 * (Privacy P3 §3.2). After the 30-day purge the photos are physically gone, so
 * the export ZIP is the only surviving copy; a keys-only manifest is not a "full
 * data export". Photo bytes are streamed into the ZIP under a size budget so a
 * large tenant cannot blow the Worker's memory limit — photos beyond the budget
 * stay listed (with included=false) in photos-manifest.json.
 */
import { describe, it, expect, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { DataExportService } from '../../server/services/data-export.service';

// buildZip queries D1; stub drizzle to return empty result sets so the tests
// focus on the photo-bytes behaviour. (vi.mock is hoisted above the import.)
vi.mock('drizzle-orm/d1', () => {
    const empty = { where: () => ({ all: async () => [] }) };
    const d = { select: () => ({ from: () => empty }) };
    return { drizzle: () => d };
});

const TENANT = '00000000-0000-0000-0000-000000000001';

function makeR2(objects: { key: string; size: number; bytes: number[] }[]) {
    return {
        list: async () => ({ objects: objects.map(o => ({ key: o.key, size: o.size })), truncated: false, cursor: undefined }),
        get: async (key: string) => {
            const o = objects.find(x => x.key === key);
            if (!o) return null;
            return { arrayBuffer: async () => new Uint8Array(o.bytes).buffer };
        },
    } as unknown as R2Bucket;
}

describe('DataExportService.buildZip — photo bytes', () => {
    it('streams photo bytes into a photos/ folder inside the ZIP', async () => {
        const r2 = makeR2([
            { key: `tenants/${TENANT}/a.jpg`, size: 3, bytes: [1, 2, 3] },
            { key: `tenants/${TENANT}/sub/b.jpg`, size: 2, bytes: [9, 8] },
        ]);
        const svc = new DataExportService({} as D1Database, r2);
        const { buffer, manifest } = await svc.buildZip(TENANT);

        const unzipped = unzipSync(buffer);
        const names = Object.keys(unzipped).sort();
        expect(names).toContain(`photos/tenants/${TENANT}/a.jpg`);
        expect(names).toContain(`photos/tenants/${TENANT}/sub/b.jpg`);
        expect(unzipped[`photos/tenants/${TENANT}/a.jpg`]).toEqual(new Uint8Array([1, 2, 3]));
        expect(manifest.photos).toBe(2);
        expect(manifest.photosEmbedded).toBe(2);

        // manifest records inclusion status
        const man = JSON.parse(strFromU8(unzipped['photos-manifest.json'])) as { key: string; included: boolean }[];
        expect(man.every(p => p.included)).toBe(true);
    });

    it('respects a byte budget: oversized photos stay in the manifest as included=false', async () => {
        const r2 = makeR2([
            { key: `tenants/${TENANT}/big.jpg`, size: 10, bytes: Array(10).fill(1) },
            { key: `tenants/${TENANT}/small.jpg`, size: 1, bytes: [7] },
        ]);
        const svc = new DataExportService({} as D1Database, r2, { photoBytesBudget: 5 });
        const { buffer, manifest } = await svc.buildZip(TENANT);

        const unzipped = unzipSync(buffer);
        // big.jpg (10 bytes) exceeds the 5-byte budget → not embedded
        expect(Object.keys(unzipped)).not.toContain(`photos/tenants/${TENANT}/big.jpg`);
        // small.jpg fits
        expect(Object.keys(unzipped)).toContain(`photos/tenants/${TENANT}/small.jpg`);

        expect(manifest.photos).toBe(2);
        expect(manifest.photosEmbedded).toBe(1);
        const man = JSON.parse(strFromU8(unzipped['photos-manifest.json'])) as { key: string; included: boolean }[];
        const big = man.find(p => p.key.endsWith('big.jpg'))!;
        const small = man.find(p => p.key.endsWith('small.jpg'))!;
        expect(big.included).toBe(false);
        expect(small.included).toBe(true);
    });

    it('still produces the CSV/JSON entries alongside photos', async () => {
        const r2 = makeR2([]);
        const svc = new DataExportService({} as D1Database, r2);
        const { buffer } = await svc.buildZip(TENANT);
        const unzipped = unzipSync(buffer);
        expect(Object.keys(unzipped)).toEqual(
            expect.arrayContaining(['inspections.csv', 'templates.json', 'agreements.json', 'photos-manifest.json', 'README.txt']),
        );
    });
});
