// Design System 0520 M14 — PhotoStudio annotation persistence (subsystem A,
// phase 4). The annotation payload is opaque to the server — only the size
// bound is enforced. Caption is user-supplied and surfaces in the published
// report. Validation runs server-side via OpenAPIHono createRoute().
import { z } from '@hono/zod-openapi';

export const UpdateMediaAnnotationsSchema = z.object({
    annotations: z.string().max(8 * 1024, 'annotations must be ≤ 8 KB').describe('TODO describe annotations field for the OpenInspection MCP integration'),
    caption:     z.string().max(200, 'caption must be ≤ 200 chars').describe('TODO describe caption field for the OpenInspection MCP integration'),
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
    caption: z.string().max(200, 'caption must be ≤ 200 chars').optional()
        .describe('Optional caption to remember for the clip once uploaded'),
    itemId: z.string().min(1).optional()
        .describe('Optional inspection item id remembering placement intent'),
}).openapi('CreateVideoUpload');

/**
 * Finalize: the client signals "upload complete" with the Stream UID it was
 * given. The server polls Stream for details and inserts the pool row.
 */
export const FinalizeVideoSchema = z.object({
    streamUid: z.string().min(1, 'streamUid is required')
        .describe('Cloudflare Stream UID returned by create-upload'),
}).openapi('FinalizeVideo');

/**
 * Set the poster frame as a fraction of the video duration (0..1). Stream
 * consumes `thumbnailTimestampPct`; we clamp the input here at the edge.
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
export type FinalizeVideoInput = z.infer<typeof FinalizeVideoSchema>;
export type SetPosterInput = z.infer<typeof SetPosterSchema>;
export type DeleteVideoInput = z.infer<typeof DeleteVideoSchema>;
