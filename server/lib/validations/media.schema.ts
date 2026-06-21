// Design System 0520 M14 — PhotoStudio annotation persistence (subsystem A,
// phase 4). The annotation payload is opaque to the server — only the size
// bound is enforced. Caption is user-supplied and surfaces in the published
// report. Validation runs server-side via OpenAPIHono createRoute().
import { z } from '@hono/zod-openapi';

export const UpdateMediaAnnotationsSchema = z.object({
    annotations: z.string().max(8 * 1024, 'annotations must be <= 8 KB').describe('TODO describe annotations field for the OpenInspection MCP integration'),
    caption:     z.string().max(200, 'caption must be <= 200 chars').describe('TODO describe caption field for the OpenInspection MCP integration'),
}).openapi('UpdateMediaAnnotations');

export type UpdateMediaAnnotationsInput = z.infer<typeof UpdateMediaAnnotationsSchema>;

// ── Plan 7 — video walk-through (Cloudflare Stream direct creator upload) ────
// The server never receives a client-supplied tenantId for any of these — it
// comes from the JWT in the route handler. Bodies carry only placement intent
// and Stream-side identifiers.

/**
 * Request a direct-creator-upload URL. The body may carry an optional caption
 * and an optional itemId remembering where the inspector intends to place the
 * clip; both are advisory and never trusted for ownership.
 */
export const CreateVideoUploadSchema = z.object({
    caption: z.string().max(200, 'caption must be <= 200 chars').optional()
        .describe('Optional caption to remember for the clip once uploaded'),
    itemId: z.string().min(1).optional()
        .describe('Optional inspection item id remembering placement intent'),
}).openapi('CreateVideoUpload');

/**
 * Discriminated VideoRef used by the finalize and other resolver-driven
 * endpoints. The client echoes back the `ref` received from create-upload.
 * The real r2Key from the r2-upload response MUST be used, not the
 * placeholder key from create-upload (which uses a .mp4 extension stub).
 */
export const VideoRefSchema = z.discriminatedUnion('provider', [
    z.object({
        provider: z.literal('stream'),
        streamUid: z.string().min(1, 'streamUid is required')
            .describe('Cloudflare Stream UID returned by create-upload'),
    }),
    z.object({
        provider: z.literal('r2'),
        mediaId: z.string().min(1, 'mediaId is required')
            .describe('R2 media row id (UUID) from r2-upload response'),
        r2Key: z.string().min(1, 'r2Key is required')
            .describe('Real R2 object key from r2-upload response (with correct extension)'),
        posterKey: z.string().optional()
            .describe('R2 poster object key from r2-upload-poster response'),
    }),
]).openapi('VideoRef');

/**
 * Finalize: the client signals "upload complete" with the ref it was given
 * at create-upload time (echoed back with the real r2Key from r2-upload for
 * the R2 path, or streamUid for the Stream path).
 */
export const FinalizeVideoSchema = VideoRefSchema;

/**
 * Set the poster frame as a fraction of the video duration (0..1). Stream
 * consumes `thumbnailTimestampPct`; we clamp the input here at the edge.
 * This endpoint is Stream-only; R2 videos use the r2-upload-poster route
 * to store a JPEG poster image.
 */
export const SetPosterSchema = z.object({
    streamUid: z.string().min(1, 'streamUid is required')
        .describe('Cloudflare Stream UID'),
    posterPct: z.number().min(0).max(1)
        .describe('Poster timestamp as a fraction of duration (0..1)'),
}).openapi('SetPoster');

/** Delete a video from Stream + drop its pool row / detach the entry. */
export const DeleteVideoSchema = z.object({
    streamUid: z.string().min(1, 'streamUid is required')
        .describe('Cloudflare Stream UID'),
}).openapi('DeleteVideo');

export type CreateVideoUploadInput = z.infer<typeof CreateVideoUploadSchema>;
export type VideoRefInput = z.infer<typeof VideoRefSchema>;
export type FinalizeVideoInput = z.infer<typeof FinalizeVideoSchema>;
export type SetPosterInput = z.infer<typeof SetPosterSchema>;
export type DeleteVideoInput = z.infer<typeof DeleteVideoSchema>;
