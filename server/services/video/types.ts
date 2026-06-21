/**
 * Pluggable video backend interface.
 *
 * VideoBackend decouples the video lifecycle (upload minting, finalization,
 * details retrieval, deletion) from the concrete storage provider. The Stream
 * backend is the initial implementation; R2VideoBackend follows in the next
 * task and is selected by a resolver at runtime.
 */

/** Discriminated union identifying which backend owns a particular video. */
export type VideoRef =
    | { provider: 'stream'; streamUid: string }
    | { provider: 'r2'; mediaId: string; r2Key: string };

/** Normalized video readiness / progress returned by any backend. */
export interface VideoDetails {
    readyToStream: boolean;
    pctComplete?: number;
    durationSec?: number;
}

/**
 * Contract every video backend must satisfy.
 *
 * Implementations are responsible for tenant-ownership enforcement — callers
 * (route handlers) pass the tenantId once at construction time and the backend
 * fails closed on any mismatch.
 */
export interface VideoBackend {
    /** Mint a one-shot upload URL and return a VideoRef identifying the pending video. */
    createUpload(inspectionId: string): Promise<{ uploadURL: string; ref: VideoRef }>;

    /**
     * Finalize an upload: insert (or idempotently update) the inspection_media_pool
     * row and return the pool row id.
     */
    finalize(ref: VideoRef, posterRef?: { posterKey: string }): Promise<{ poolId: string }>;

    /** Retrieve normalized playback/progress details for a video. */
    getDetails(ref: VideoRef): Promise<VideoDetails>;

    /** Delete the video from the backend storage (and drop its pool row if present). */
    delete(ref: VideoRef): Promise<void>;
}
