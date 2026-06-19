/**
 * Plan 7 — Cloudflare Stream service wrapper for video walk-throughs.
 *
 * PRIVACY (backlog N8/N2): video bytes NEVER transit the worker. The browser
 * POSTs the file straight to Cloudflare via a one-shot direct-creator-upload
 * URL minted here, so there is no R2/worker code path that could read or
 * persist GPS-bearing container metadata. Cloudflare Stream additionally
 * RE-TRANSCODES on ingest, which drops container-level GPS/EXIF — the video
 * analogue of Plan 2's photo strip-on-ingest. We also never persist any
 * client-supplied geo field for videos (no GPS column on video pool rows).
 *
 * OWNERSHIP: Stream videos are not D1 rows with a tenant filter. The only
 * proof of ownership is the `meta.tenantId` envelope written at upload time.
 * Every read/mutate (getDetails/setPoster/deleteVideo) re-reads it and FAILS
 * CLOSED on mismatch, so a guessed/cross-tenant streamUid cannot be touched.
 */
import { Errors } from '../lib/errors';

/**
 * Hard cap on clip length (seconds). Backlog N8 — Stream enforces the duration
 * at the edge (uploads exceeding it fail during processing); the worker passes
 * this as `maxDurationSeconds`, it does not police bytes itself.
 */
export const MAX_DURATION_SEC = 30;

/** Subset of Stream video details the app consumes. */
export interface VideoDetails {
    readyToStream: boolean;
    duration: number;
    thumbnailTimestampPct: number;
    status: StreamVideoStatus;
    meta: Record<string, string>;
}

export class MediaVideoService {
    /**
     * @param stream    the `env.STREAM` binding
     * @param tenantId  caller's tenant (from JWT — never the request body)
     * @param appOrigin app base URL used for Stream `allowedOrigins`
     */
    constructor(
        private readonly stream: StreamBinding,
        private readonly tenantId: string,
        private readonly appOrigin: string,
    ) {}

    /**
     * Mint a one-shot direct-creator-upload URL. The browser POSTs the file
     * straight to Cloudflare (bytes bypass the worker). The `meta` envelope
     * stamps tenant + inspection ownership for later guard checks.
     */
    async createUpload(inspectionId: string): Promise<{ uploadURL: string; streamUid: string }> {
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
        return { uploadURL: result.uploadURL, streamUid: result.id };
    }

    /**
     * Read video details after re-asserting tenant ownership via the meta
     * envelope. Fails closed on mismatch.
     */
    async getDetails(streamUid: string): Promise<VideoDetails> {
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

    /**
     * Set the poster frame (`thumbnailTimestampPct`, a 0..1 fraction). Guards
     * ownership first.
     */
    async setPoster(streamUid: string, posterPct: number): Promise<void> {
        await this.assertOwnershipByUid(streamUid);
        await this.stream.video(streamUid).update({ thumbnailTimestampPct: posterPct });
    }

    /** Delete the video from Stream. Guards ownership first (fail closed). */
    async deleteVideo(streamUid: string): Promise<void> {
        await this.assertOwnershipByUid(streamUid);
        await this.stream.video(streamUid).delete();
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
