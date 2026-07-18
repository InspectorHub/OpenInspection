/**
 * Cloudflare Stream implementation of VideoBackend.
 *
 * All ownership enforcement flows through the `meta.tenantId` envelope written
 * at upload time. Every read/mutate operation re-reads the envelope and fails
 * CLOSED on tenant mismatch — a guessed or cross-tenant streamUid cannot be
 * touched even without D1-level tenant filters (Stream videos are not D1 rows).
 *
 * Behavior is verbatim-equivalent to the prior MediaVideoService + the finalize
 * and delete pool-row logic that previously lived in the route handler. Moving
 * them here keeps the route handlers thin and makes the backend self-contained.
 */
import type { DrizzleD1Database } from 'drizzle-orm/d1';
import { eq, and } from 'drizzle-orm';
import { inspectionMediaPool } from '../../lib/db/schema';
import { Errors } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { MAX_DURATION_SEC } from '../media-video.service';
import type { VideoBackend, VideoDetails, VideoRef } from './types';

export class StreamVideoBackend implements VideoBackend {
    /**
     * @param stream      the `env.STREAM` binding
     * @param tenantId    caller's tenant (from JWT — never the request body)
     * @param appOrigin   app base URL used for Stream `allowedOrigins`
     * @param db          Drizzle D1 database instance (needed for finalize + delete pool row)
     */
    constructor(
        private readonly stream: StreamBinding,
        private readonly tenantId: string,
        private readonly appOrigin: string,
        private readonly db: DrizzleD1Database,
    ) {}

    /**
     * Mint a one-shot direct-creator-upload URL. The browser POSTs the file
     * straight to Cloudflare (bytes bypass the worker). The `meta` envelope
     * stamps tenant + inspection ownership for later guard checks.
     */
    async createUpload(inspectionId: string): Promise<{ uploadURL: string; ref: VideoRef }> {
        const result = await this.stream.createDirectUpload({
            maxDurationSeconds: MAX_DURATION_SEC,
            requireSignedURLs: false,
            allowedOrigins: [this.appOrigin],
            creator: this.tenantId,
            meta: {
                tenantId: this.tenantId,
                inspectionId,
                app: 'openinspection',
            },
        });
        return {
            uploadURL: result.uploadURL,
            ref: { provider: 'stream', streamUid: result.id },
        };
    }

    /**
     * Finalize a Stream upload: insert (or idempotently update) the
     * inspection_media_pool row. Idempotency is based on streamUid — a
     * retry will find the existing row and update durationSec rather than
     * creating a duplicate.
     *
     * The `posterRef` parameter is accepted for interface conformance but is
     * not used by the Stream backend (Stream manages its own poster via
     * thumbnailTimestampPct; there is no R2 poster key for Stream videos).
     *
     * inspectionId is read from video.meta.inspectionId (set by createUpload) —
     * the Stream meta is the authoritative source, not a constructor field, so
     * finalize cannot be called with a mismatched or missing inspectionId.
     */
    async finalize(ref: VideoRef, _posterRef?: { posterKey: string }): Promise<{ poolId: string }> {
        if (ref.provider !== 'stream') {
            throw Errors.BadRequest('StreamVideoBackend.finalize called with non-stream ref');
        }
        const { streamUid } = ref;

        // Tenant-guarded read of the Stream meta envelope (fail closed).
        // meta.inspectionId was stamped at createUpload time and is the
        // authoritative inspectionId for the pool-row insert.
        const rawDetails = await this.getRawDetails(streamUid);
        const durationSec = Number.isFinite(rawDetails.duration) && rawDetails.duration > 0
            ? Math.round(rawDetails.duration)
            : null;

        const inspectionId = rawDetails.meta.inspectionId;
        if (!inspectionId) {
            // Fail closed — a pool row with a missing inspectionId would be
            // an orphan. This should never happen if createUpload was called
            // correctly, but guard against corrupted or externally-created videos.
            throw Errors.NotFound('Video not found: meta.inspectionId is absent');
        }

        // Idempotent on streamUid: a retry must not create a duplicate pool row.
        const existing = await this.db
            .select({ id: inspectionMediaPool.id })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.streamUid, streamUid),
                eq(inspectionMediaPool.tenantId, this.tenantId),
            ))
            .get();

        let poolId: string;
        if (existing) {
            poolId = existing.id;
            await this.db
                .update(inspectionMediaPool)
                .set({ durationSec })
                .where(and(
                    eq(inspectionMediaPool.id, poolId),
                    eq(inspectionMediaPool.tenantId, this.tenantId),
                ));
        } else {
            poolId = crypto.randomUUID();
            await this.db.insert(inspectionMediaPool).values({
                id: poolId,
                inspectionId,
                tenantId: this.tenantId,
                provider: 'stream',
                r2Key: '',     // video bytes live in Cloudflare Stream, not R2
                url: '',       // playback URL is derived from streamUid client-side
                uploadedAt: new Date(),
                mediaType: 'video',
                streamUid,
                durationSec,
            });
        }

        logger.info('StreamVideoBackend: finalized video', {
            streamUid,
            poolId,
            inspectionId,
            tenantId: this.tenantId,
        });

        return { poolId };
    }

    /**
     * Read normalized video details after re-asserting tenant ownership via
     * the meta envelope. Fails closed on mismatch.
     */
    async getDetails(ref: VideoRef): Promise<VideoDetails> {
        if (ref.provider !== 'stream') {
            throw Errors.BadRequest('StreamVideoBackend.getDetails called with non-stream ref');
        }
        const raw = await this.getRawDetails(ref.streamUid);
        const details: VideoDetails = { readyToStream: raw.readyToStream };
        if (Number.isFinite(raw.duration) && raw.duration > 0) {
            details.durationSec = Math.round(raw.duration);
        }
        return details;
    }

    /**
     * Delete the video from Cloudflare Stream (tenant-guarded) and drop the
     * corresponding inspection_media_pool row.
     */
    async delete(ref: VideoRef): Promise<void> {
        if (ref.provider !== 'stream') {
            throw Errors.BadRequest('StreamVideoBackend.delete called with non-stream ref');
        }
        const { streamUid } = ref;
        // Ownership guard — fails closed (404) on mismatch.
        await this.assertOwnershipByUid(streamUid);
        await this.stream.video(streamUid).delete();

        await this.db
            .delete(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.streamUid, streamUid),
                eq(inspectionMediaPool.tenantId, this.tenantId),
            ));
    }

    // ── Internal helpers ─────────────────────────────────────────────────────

    /**
     * Fetch raw Stream video details and assert tenant ownership in one shot.
     * Returns the raw Stream response so callers can extract provider-specific
     * fields (duration, thumbnailTimestampPct, status) before normalization.
     */
    private async getRawDetails(streamUid: string): Promise<{
        readyToStream: boolean;
        duration: number;
        thumbnailTimestampPct: number;
        status: unknown;
        meta: Record<string, string>;
    }> {
        const video = await this.stream.video(streamUid).details();
        this.assertOwnership(video.meta);
        return {
            readyToStream: video.readyToStream,
            duration: video.duration,
            thumbnailTimestampPct: video.thumbnailTimestampPct,
            status: video.status,
            meta: video.meta,
        };
    }

    private async assertOwnershipByUid(streamUid: string): Promise<void> {
        const video = await this.stream.video(streamUid).details();
        this.assertOwnership(video.meta);
    }

    private assertOwnership(meta: Record<string, string> | undefined): void {
        if (!meta || meta.tenantId !== this.tenantId) {
            // 404, not 403 — do not confirm the video exists to a non-owner.
            throw Errors.NotFound('Video not found');
        }
    }
}
