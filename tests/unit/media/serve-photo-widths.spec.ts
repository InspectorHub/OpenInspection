/**
 * A thumbnail width is rounded up to one of a fixed set, so a caller cannot make the image service render one photo at every width from
 * 16 to 2000. Every refusal to follow the number asked for sits beside the widths the product itself asks for, which must come out exact.
 */
import { describe, it, expect } from 'vitest';
import { servePhotoObject, THUMBNAIL_WIDTHS } from '../../../server/lib/media/serve-photo';

function bucket(): R2Bucket {
    return {
        get: async () => ({ body: new Blob([new Uint8Array([1, 2, 3])]).stream(), httpMetadata: { contentType: 'image/jpeg' }, customMetadata: {}, httpEtag: '"e"' }),
    } as unknown as R2Bucket;
}

function images(widths: number[]) {
    return {
        input: () => ({
            transform: (o: { width: number }) => {
                widths.push(o.width);
                return { output: async () => ({ response: () => new Response('webp', { headers: { 'Content-Type': 'image/webp' } }) }) };
            },
        }),
    };
}

async function widthFor(requested: string): Promise<number | null> {
    const widths: number[] = [];
    await servePhotoObject(bucket(), images(widths), 'k', { width: requested });
    return widths[0] ?? null;
}

describe('thumbnail widths', () => {
    it('keep every width the product asks for exact', async () => {
        for (const w of [240, 320, 480, 800, 1600]) expect(await widthFor(String(w)), String(w)).toBe(w);
    });

    it('round any other width up to the next allowed one, never down, and cap at the largest', async () => {
        expect(await widthFor('481')).toBe(640);
        expect(await widthFor('500')).toBe(640);
        expect(await widthFor('1601')).toBe(2000);
        expect(await widthFor('5000')).toBe(2000);
        expect(await widthFor('1')).toBe(16);
        expect(await widthFor('abc')).toBe(16);
    });

    it('produce a bounded number of distinct renders however many widths are asked for', async () => {
        const widths: number[] = [];
        for (let w = 1; w <= 2100; w += 3) await servePhotoObject(bucket(), images(widths), 'k', { width: String(w) });
        const distinct = new Set(widths);
        // Control: the loop asked 700 times and the image service was called each time.
        expect(widths.length).toBe(700);
        expect(distinct.size).toBeLessThanOrEqual(THUMBNAIL_WIDTHS.length);
        for (const w of distinct) expect(THUMBNAIL_WIDTHS as readonly number[]).toContain(w);
    });

    it('serve the original when no width is asked for', async () => {
        const widths: number[] = [];
        const res = await servePhotoObject(bucket(), images(widths), 'k', {});
        expect(widths).toEqual([]);
        expect(res?.headers.get('content-type')).toBe('image/jpeg');
    });
});
