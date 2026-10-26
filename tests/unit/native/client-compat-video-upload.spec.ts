/**
 * `/api/client/compat` tells a native client how it may upload a large video. The field is additive:
 * an older server simply lacks it, and a deployment with native clients switched off does not offer it.
 * Values come from the same constants the upload routes enforce, never from a second copy.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { MAX_OPEN_VIDEO_UPLOADS, MAX_VIDEO_BYTES, VIDEO_PART_BYTES } from '../../../server/lib/media/video-types';
import { createUploadHarness, type UploadHarness } from '../helpers/native-upload-harness';

interface Compat { data: Record<string, unknown> & { videoUpload?: Record<string, unknown> } }

describe('client compat: video upload', () => {
    let u: UploadHarness | undefined;
    afterEach(() => { u?.close(); u = undefined; });
    const compat = async (env: Record<string, unknown> = {}): Promise<Response> => {
        u ??= await createUploadHarness();
        return u.call('/api/client/compat?platform=ios', {}, { auth: null, env });
    };

    it('describes the chunked route, its sizes and the single-request fallback', async () => {
        const res = await compat();
        expect(res.status, await res.clone().text()).toBe(200);
        const { data } = (await res.json()) as Compat;
        expect(data.videoUpload).toEqual({
            path: '/api/public/uploads/video/chunked',
            chunkBytes: VIDEO_PART_BYTES,
            maxBytes: MAX_VIDEO_BYTES,
            maxOpen: MAX_OPEN_VIDEO_UPLOADS,
            methods: ['chunked', 'form'],
        });
        // The existing keys are untouched (additive field).
        expect(data).toMatchObject({ serverContractVersion: 2 });
        expect(Object.keys(data)).toContain('minSupported');
    });

    it('is absent when native clients are switched off (control: present when on)', async () => {
        const off = await compat({ NATIVE_CLIENT_ENABLED: 'false' });
        expect(off.status).toBe(200);
        expect(((await off.json()) as Compat).data).not.toHaveProperty('videoUpload');
        expect(((await (await compat()).json()) as Compat).data).toHaveProperty('videoUpload');
    });
});
