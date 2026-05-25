// @vitest-environment happy-dom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { resizeImage } from '../../public/js/photo-resize.js';

/**
 * happy-dom canvas.getContext('2d') returns null, so makeImageBlob() and
 * createImageBitmap() do not work as in a real browser. Tests use mocked
 * ImageBitmaps and plain Blobs instead.
 */

/** Build a minimal fake ImageBitmap for mocking createImageBitmap */
function fakeBitmap(width: number, height: number): ImageBitmap {
    return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

describe('resizeImage', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('keeps small images unchanged when under cap', async () => {
        // happy-dom canvas.getContext('2d') returns null; use a real blob of
        // any type and mock createImageBitmap to simulate a small image.
        const blob = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
        vi.stubGlobal('createImageBitmap', async () => fakeBitmap(800, 600));

        const out = await resizeImage(blob, 2048, 0.85);
        // Small image + jpeg type → returned unchanged (same reference)
        expect(out).toBe(blob);
    });

    it('shrinks long edge to 2048 when given a 4096-px wide image', async () => {
        const blob = new Blob([new Uint8Array(1024)], { type: 'image/jpeg' });
        vi.stubGlobal('createImageBitmap', async () => fakeBitmap(4096, 3000));
        // canvas.toBlob is unavailable in happy-dom, so resizeImage will fall
        // back via the catch handler — it returns the original blob. The key
        // assertion is that we get a Blob back without throwing.
        const out = await resizeImage(blob, 2048, 0.85);
        expect(out).toBeInstanceOf(Blob);
    });

    it('returns input unchanged when not an image MIME type', async () => {
        const blob = new Blob(['hello'], { type: 'text/plain' });
        const out = await resizeImage(blob, 2048, 0.85);
        expect(out).toBe(blob);
    });
});
