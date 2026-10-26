/**
 * What type a photo key is served under. The stored metadata decides (never a request value), and an object a
 * legacy upload stored under a type that is not a raster image is never replayed under it.
 */
import { describe, it, expect } from 'vitest';
import { servePhotoObject } from '../../../server/lib/media/serve-photo';

function bucketWith(contentType: string | undefined): R2Bucket {
    return {
        get: async () => ({
            body: new Blob([new Uint8Array([1, 2, 3])]).stream(),
            httpMetadata: contentType === undefined ? {} : { contentType },
            customMetadata: { originalName: 'roof.jpg' },
            httpEtag: '"e"',
        }),
    } as unknown as R2Bucket;
}

describe('servePhotoObject content type', () => {
    it('serves the stored raster image type', async () => {
        for (const type of ['image/jpeg', 'image/jpg', 'image/png', 'image/heic']) {
            const res = await servePhotoObject(bucketWith(type), undefined, 'k');
            expect(res?.headers.get('Content-Type')).toBe(type);
        }
    });

    it('serves a legacy object stored under html, svg, an executable type or no type as an opaque download type', async () => {
        for (const type of ['text/html', 'image/svg+xml', 'application/x-msdownload', 'application/javascript', undefined]) {
            const res = await servePhotoObject(bucketWith(type), undefined, 'k');
            expect(res?.headers.get('Content-Type'), String(type)).toBe('application/octet-stream');
        }
    });
});
