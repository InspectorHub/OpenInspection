import { describe, it, expect } from 'vitest';
import {
    buildAppendixPhotoInputs,
    APPENDIX_PHOTO_TOTAL_BYTE_BUDGET,
} from '../../../server/services/report-export-consumer';

// A minimal R2Bucket stub: `get(key)` resolves to an object whose
// `arrayBuffer()` returns a buffer of the byte size registered for that key
// (or null when the key is unknown, mirroring a missing R2 object).
function fakeBucket(sizes: Record<string, number>): R2Bucket {
    return {
        get: async (key: string) => {
            const n = sizes[key];
            if (n == null) return null;
            return { arrayBuffer: async () => new ArrayBuffer(n) };
        },
    } as unknown as R2Bucket;
}

const MB = 1024 * 1024;

function appendixOf(keys: string[]) {
    return keys.map((key, i) => ({ photoNo: i + 1, key, caption: null }));
}

describe('buildAppendixPhotoInputs — memory budget (env.IMAGES unset)', () => {
    it('embeds photos in order until the byte budget is reached, then omits the rest', async () => {
        // 5 x 10 MiB originals, budget 32 MiB → first three (30 MiB) fit, 4th/5th omitted.
        const keys = ['a', 'b', 'c', 'd', 'e'];
        const sizes = Object.fromEntries(keys.map((k) => [k, 10 * MB]));
        const out = await buildAppendixPhotoInputs(fakeBucket(sizes), undefined, appendixOf(keys));

        expect(out.length).toBe(3);
        expect(out.map((p) => p.photoNo)).toEqual(['1', '2', '3']);
        const total = out.reduce((n, p) => n + p.bytes.byteLength, 0);
        expect(total).toBeLessThanOrEqual(APPENDIX_PHOTO_TOTAL_BYTE_BUDGET);
    });

    it('always keeps at least one photo even if a single original exceeds the whole budget', async () => {
        const out = await buildAppendixPhotoInputs(
            fakeBucket({ big: APPENDIX_PHOTO_TOTAL_BYTE_BUDGET + 8 * MB }),
            undefined,
            appendixOf(['big']),
        );
        expect(out.length).toBe(1);
    });

    it('embeds every photo when they all fit under the budget (downscaled-size case)', async () => {
        // 100 x 200 KiB ≈ 20 MiB total < 32 MiB → all embedded, like the IMAGES-bound path.
        const keys = Array.from({ length: 100 }, (_, i) => `p${i}`);
        const sizes = Object.fromEntries(keys.map((k) => [k, 200 * 1024]));
        const out = await buildAppendixPhotoInputs(fakeBucket(sizes), undefined, appendixOf(keys));
        expect(out.length).toBe(100);
    });

    it('skips photos missing in R2 without counting them against the budget', async () => {
        // 'gone' returns null (missing) and must not break the export or the budget.
        const out = await buildAppendixPhotoInputs(
            fakeBucket({ a: 1 * MB, c: 1 * MB }),
            undefined,
            appendixOf(['a', 'gone', 'c']),
        );
        expect(out.map((p) => p.photoNo)).toEqual(['1', '3']);
    });
});
