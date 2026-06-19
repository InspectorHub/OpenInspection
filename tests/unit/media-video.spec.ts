import { describe, it, expect, vi } from 'vitest';
import { MediaVideoService, MAX_DURATION_SEC } from '../../server/services/media-video.service';
import { SetPosterSchema } from '../../server/lib/validations/media.schema';

/** Build a mock StreamBinding capturing calls + returning canned details. */
function makeStreamMock(details?: Partial<{ meta: Record<string, string>; duration: number; readyToStream: boolean; thumbnailTimestampPct: number; status: unknown }>) {
    const createDirectUpload = vi.fn().mockResolvedValue({ uploadURL: 'https://upload.example/abc', id: 'vid-123' });
    const update = vi.fn().mockResolvedValue({});
    const del = vi.fn().mockResolvedValue(undefined);
    const detailsFn = vi.fn().mockResolvedValue({
        meta: details?.meta ?? { tenantId: 't-1' },
        duration: details?.duration ?? 12,
        readyToStream: details?.readyToStream ?? true,
        thumbnailTimestampPct: details?.thumbnailTimestampPct ?? 0,
        status: details?.status ?? { state: 'ready' },
    });
    const video = vi.fn().mockReturnValue({ details: detailsFn, update, delete: del });
    const stream = { createDirectUpload, video } as unknown as StreamBinding;
    return { stream, createDirectUpload, update, del, detailsFn, video };
}

describe('MediaVideoService.createUpload', () => {
    it('passes maxDurationSeconds=30 and a tenant-scoped meta envelope', async () => {
        const { stream, createDirectUpload } = makeStreamMock();
        const svc = new MediaVideoService(stream, 't-1', 'https://app.example');
        const out = await svc.createUpload('insp-1');

        expect(createDirectUpload).toHaveBeenCalledTimes(1);
        const params = createDirectUpload.mock.calls[0][0];
        expect(params.maxDurationSeconds).toBe(30);
        expect(MAX_DURATION_SEC).toBe(30);
        expect(params.meta.tenantId).toBe('t-1');
        expect(params.meta.inspectionId).toBe('insp-1');
        expect(params.creator).toBe('t-1');
        expect(params.allowedOrigins).toContain('https://app.example');
        expect(params.requireSignedURLs).toBe(false);
        expect(out).toEqual({ uploadURL: 'https://upload.example/abc', streamUid: 'vid-123' });
    });
});

describe('MediaVideoService tenant guard', () => {
    it('getDetails rejects when the Stream meta.tenantId mismatches', async () => {
        const { stream } = makeStreamMock({ meta: { tenantId: 'other-tenant' } });
        const svc = new MediaVideoService(stream, 't-1', 'https://app.example');
        await expect(svc.getDetails('vid-123')).rejects.toThrow();
    });

    it('getDetails returns details when tenant matches', async () => {
        const { stream } = makeStreamMock({ meta: { tenantId: 't-1' }, duration: 18 });
        const svc = new MediaVideoService(stream, 't-1', 'https://app.example');
        const d = await svc.getDetails('vid-123');
        expect(d.duration).toBe(18);
        expect(d.readyToStream).toBe(true);
    });

    it('deleteVideo rejects on tenant mismatch and never calls delete', async () => {
        const { stream, del } = makeStreamMock({ meta: { tenantId: 'other-tenant' } });
        const svc = new MediaVideoService(stream, 't-1', 'https://app.example');
        await expect(svc.deleteVideo('vid-123')).rejects.toThrow();
        expect(del).not.toHaveBeenCalled();
    });
});

describe('MediaVideoService.setPoster', () => {
    it('forwards the clamped posterPct to Stream as thumbnailTimestampPct', async () => {
        const { stream, update } = makeStreamMock({ meta: { tenantId: 't-1' } });
        const svc = new MediaVideoService(stream, 't-1', 'https://app.example');
        await svc.setPoster('vid-123', 0.42);
        expect(update).toHaveBeenCalledWith({ thumbnailTimestampPct: 0.42 });
    });
});

describe('SetPosterSchema clamping', () => {
    it('rejects posterPct outside [0,1]', () => {
        expect(SetPosterSchema.safeParse({ streamUid: 'x', posterPct: 1.5 }).success).toBe(false);
        expect(SetPosterSchema.safeParse({ streamUid: 'x', posterPct: -0.1 }).success).toBe(false);
        expect(SetPosterSchema.safeParse({ streamUid: 'x', posterPct: 0.5 }).success).toBe(true);
    });
});
