import { describe, it, expect, vi } from 'vitest';
import { MediaVideoService, MAX_DURATION_SEC } from '../../../server/services/media-video.service';
import { StreamVideoBackend } from '../../../server/services/video/stream-backend';
import { SetPosterSchema } from '../../../server/lib/validations/media.schema';

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

/** Build a minimal Drizzle D1 mock sufficient for finalize + delete. */
function makeDbMock(existingRow?: { id: string } | null) {
    const getMock = vi.fn().mockResolvedValue(existingRow ?? null);
    const updateSetMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const insertValuesMock = vi.fn().mockResolvedValue(undefined);
    const deleteMock = vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) });
    const selectFromMock = {
        from: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({ get: getMock }),
        }),
    };
    const db = {
        select: vi.fn().mockReturnValue(selectFromMock),
        update: vi.fn().mockReturnValue({ set: updateSetMock }),
        insert: vi.fn().mockReturnValue({ values: insertValuesMock }),
        delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    } as unknown as import('drizzle-orm/d1').DrizzleD1Database;
    return { db, getMock, insertValuesMock, updateSetMock, deleteMock };
}

// ── MediaVideoService tests (preserved verbatim) ────────────────────────────

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

// ── StreamVideoBackend tests ─────────────────────────────────────────────────

describe('StreamVideoBackend.createUpload', () => {
    it('passes maxDurationSeconds=30 and a tenant-scoped meta envelope', async () => {
        const { stream, createDirectUpload } = makeStreamMock();
        const { db } = makeDbMock();
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);
        const out = await backend.createUpload('insp-1');

        expect(createDirectUpload).toHaveBeenCalledTimes(1);
        const params = createDirectUpload.mock.calls[0][0];
        expect(params.maxDurationSeconds).toBe(30);
        expect(params.meta.tenantId).toBe('t-1');
        expect(params.meta.inspectionId).toBe('insp-1');
        expect(params.meta.app).toBe('openinspection');
        expect(params.creator).toBe('t-1');
        expect(params.allowedOrigins).toContain('https://app.example');
        expect(params.requireSignedURLs).toBe(false);
        // Returns a VideoRef with provider:'stream'
        expect(out).toEqual({
            uploadURL: 'https://upload.example/abc',
            ref: { provider: 'stream', streamUid: 'vid-123' },
        });
    });
});

describe('StreamVideoBackend tenant guard', () => {
    it('getDetails rejects with NotFound (404) when Stream meta.tenantId mismatches', async () => {
        const { stream } = makeStreamMock({ meta: { tenantId: 'other-tenant' } });
        const { db } = makeDbMock();
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);
        await expect(backend.getDetails({ provider: 'stream', streamUid: 'vid-123' }))
            .rejects.toThrow(/not found/i);
    });

    it('getDetails returns normalized VideoDetails when tenant matches', async () => {
        const { stream } = makeStreamMock({ meta: { tenantId: 't-1' }, duration: 18, readyToStream: true });
        const { db } = makeDbMock();
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);
        const d = await backend.getDetails({ provider: 'stream', streamUid: 'vid-123' });
        expect(d.readyToStream).toBe(true);
        expect(d.durationSec).toBe(18);
    });

    it('delete rejects with NotFound (404) on tenant mismatch and never calls Stream delete', async () => {
        const { stream, del } = makeStreamMock({ meta: { tenantId: 'other-tenant' } });
        const { db } = makeDbMock();
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);
        await expect(backend.delete({ provider: 'stream', streamUid: 'vid-123' }))
            .rejects.toThrow(/not found/i);
        expect(del).not.toHaveBeenCalled();
    });
});

describe('StreamVideoBackend.finalize', () => {
    it('inserts a pool row with provider:stream, streamUid, mediaType:video, and inspectionId from Stream meta', async () => {
        const { stream } = makeStreamMock({
            meta: { tenantId: 't-1', inspectionId: 'insp-meta-1' },
            duration: 20,
        });
        const { db, insertValuesMock } = makeDbMock(null);
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);

        const result = await backend.finalize({ provider: 'stream', streamUid: 'vid-123' });

        expect(result.poolId).toBeTruthy();
        expect(insertValuesMock).toHaveBeenCalledTimes(1);
        const row = insertValuesMock.mock.calls[0][0];
        expect(row.provider).toBe('stream');
        expect(row.streamUid).toBe('vid-123');
        expect(row.mediaType).toBe('video');
        // inspectionId must come from Stream meta, not a constructor argument
        expect(row.inspectionId).toBe('insp-meta-1');
        expect(row.tenantId).toBe('t-1');
        expect(row.durationSec).toBe(20);
    });

    it('is idempotent — a second finalize for the same streamUid updates durationSec and does not insert a duplicate row', async () => {
        const { stream } = makeStreamMock({
            meta: { tenantId: 't-1', inspectionId: 'insp-meta-1' },
            duration: 20,
        });
        // Simulate existing row already present (idempotent path)
        const { db, insertValuesMock, updateSetMock } = makeDbMock({ id: 'existing-pool-id' });
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);

        const result = await backend.finalize({ provider: 'stream', streamUid: 'vid-123' });

        expect(result.poolId).toBe('existing-pool-id');
        // No new row inserted
        expect(insertValuesMock).not.toHaveBeenCalled();
        // Duration updated on the existing row
        expect(updateSetMock).toHaveBeenCalledWith({ durationSec: 20 });
    });

    it('throws NotFound when Stream meta.inspectionId is absent', async () => {
        // meta has tenantId but no inspectionId
        const { stream } = makeStreamMock({ meta: { tenantId: 't-1' } });
        const { db } = makeDbMock(null);
        const backend = new StreamVideoBackend(stream, 't-1', 'https://app.example', db);

        await expect(backend.finalize({ provider: 'stream', streamUid: 'vid-123' }))
            .rejects.toThrow(/not found/i);
    });
});
