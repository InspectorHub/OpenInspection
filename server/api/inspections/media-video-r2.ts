/**
 * R2 video upload + serve routes (binary payloads / Range responses).
 *
 * These plain Hono routes handle the parts of the R2 video backend that don't
 * fit the OpenAPI JSON contract: multipart uploads, JPEG poster uploads, and
 * HTTP Range-aware video serving. They are imported and wired into the
 * mediaStudioRoutes router in media-studio.ts.
 *
 * Auth model:
 *   Upload routes — token-gated via a signed upload token (verifyUploadToken).
 *                   The token is minted by R2VideoBackend.createUpload and
 *                   carries tenantId + inspectionId + mediaId. JWT middleware
 *                   is still active (tenantId from context is the guard source).
 *   Serve routes  — tenant-guarded via the inspection_media_pool row lookup:
 *                   (mediaId, tenantId, provider='r2') must exist before any
 *                   bytes are served. tenantId comes from the JWT middleware.
 */
import type { OpenAPIHono } from '@hono/zod-openapi';
import { inspectionMediaPool } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyUploadToken, type UploadTokenClaims } from '../../lib/video-upload-token';
import { r2Keys } from '../../lib/r2-keys';
import { logger } from '../../lib/logger';
import { Errors } from '../../lib/errors';
import type { HonoConfig } from '../../types/hono';
import { getDrizzle } from '../../lib/route-helpers';
import { r2Put, r2Head } from '../../lib/r2/objects';
import { serveVideoClip, serveVideoPoster } from '../../lib/media/serve-video';
import { MAX_PHOTO_BYTES } from '../../lib/media/store-photo';
import { headBytes, sniffPosterType, sniffVideoType } from '../../lib/media/sniff';
import { ALLOWED_VIDEO_MIMES, MAX_FORM_VIDEO_BYTES, MAX_VIDEO_BYTES, MIME_TO_EXT, mimeToExt } from '../../lib/media/video-types';
import { declaredLengthRefusal } from '../../lib/declared-length';
import { ownClipKey, ownPosterKey } from '../../services/video/r2-backend';

// ── MIME / extension helpers (shared with the chunked upload; see lib/media/video-types.ts) ──
export { ALLOWED_VIDEO_MIMES, MAX_VIDEO_BYTES, mimeToExt };

/** Staff session responses are private to the browser; the report link route states its own policy. */
const STAFF_VIDEO_CACHE = 'private, max-age=86400';

/** The editor has no chunked route to send a larger clip to, so this answer names the limit only (the public route's body names its chunked path). */
const STAFF_TOO_LARGE = {
    error: 'Video is too large for a single request (max 64 MiB).',
    code: 'VIDEO_TOO_LARGE_FOR_FORM',
    limits: { maxBytes: MAX_FORM_VIDEO_BYTES },
} as const;

export type StoreVideoResult =
    | { ok: true; mediaId: string; r2Key: string }
    | { ok: false; status: 400 | 413; error: string };

/**
 * Validate and store one video clip under the key its upload token fixes.
 *
 * Shared by the session-authenticated route below and the token-only public
 * route. Tenant and inspection come from the verified token claims, never from
 * the request, so the same call is safe from either entry point. The object key
 * is a pure function of `(tenant, inspection, media id, extension)`: uploading
 * the same token twice overwrites one object rather than adding another.
 */
export async function storeVideoUpload(
    env: { PHOTOS: R2Bucket },
    claims: UploadTokenClaims,
    file: File,
    maxBytes: number = MAX_VIDEO_BYTES,
): Promise<StoreVideoResult> {
    if (file.size > maxBytes) {
        return { ok: false, status: 413, error: `File exceeds the ${Math.round(maxBytes / 1024 / 1024)} MB limit (got ${Math.round(file.size / 1024 / 1024)} MB).` };
    }
    // The clip's real type (its first bytes) decides the stored type and the key extension, not the declared one.
    const mime = sniffVideoType(await headBytes(file));
    if (!mime) {
        return { ok: false, status: 400, error: 'Missing or unsupported video type. Allowed: mp4, mov, webm.' };
    }

    const { tenantId, inspectionId, mediaId } = claims;
    const r2Key = r2Keys.inspectionVideo(tenantId, inspectionId, mediaId, mimeToExt(mime));

    try {
        // The File itself is the body: no second copy of the clip is made in memory.
        await r2Put(env.PHOTOS, r2Key, file, {
            httpMetadata: { contentType: mime },
            customMetadata: { tenantId, inspectionId, mediaId },
        });
    } catch (err) {
        const detail = err instanceof Error ? err.message : String(err);
        logger.error('R2 video put failed', { tenantId, inspectionId, mediaId, r2Key }, err instanceof Error ? err : undefined);
        if (/quota|storage|capacity|exceeded/i.test(detail)) {
            throw Errors.ServiceUnavailable('Video storage is full — free up R2 space or enable Stream.');
        }
        throw err;
    }

    logger.info('r2-upload: stored video', { tenantId, inspectionId, mediaId, r2Key, bytes: file.size });
    return { ok: true, mediaId, r2Key };
}

// ── Route registration ────────────────────────────────────────────────────────

/**
 * Register R2 binary routes on the given OpenAPIHono router.
 * Called once from media-studio.ts after the .openapi() chain.
 */
export function registerR2VideoRoutes(router: OpenAPIHono<HonoConfig>): void {
    /**
     * POST /:id/media/video/r2-upload
     *
     * Token-gated multipart file upload to R2. The upload token (minted by
     * R2VideoBackend.createUpload) carries tenantId + inspectionId + mediaId
     * and is verified before any bytes are written to the bucket. The correct
     * file extension is derived from the Content-Type header; the r2Key is
     * built with the real extension (not the .mp4 placeholder from createUpload).
     * Returns { mediaId, r2Key } for the client to echo back in finalize.
     */
    router.post('/:id/media/video/r2-upload', async (c) => {
        const id = c.req.param('id');
        const tenantId = c.get('tenantId');

        const tokenStr = c.req.query('token') ?? '';
        const claims = await verifyUploadToken(tokenStr, c.env.JWT_SECRET);
        if (!claims || claims.inspectionId !== id || claims.tenantId !== tenantId) {
            return c.json({ error: 'Invalid or expired upload token' }, 401);
        }

        // Refuse a body that declares more than the cap BEFORE it is buffered: reading a 150 MiB upload first would fill the Worker's memory.
        // A caller behind a session and a signed token that declares no length is still checked after the body is read (storeVideoUpload).
        const refusedLength = declaredLengthRefusal(c, MAX_FORM_VIDEO_BYTES, STAFF_TOO_LARGE, { requireLength: false });
        if (refusedLength) return refusedLength;

        const formData = await c.req.parseBody();
        const file = formData['file'] as File | undefined;
        if (!file) {
            return c.json({ error: 'file field required' }, 400);
        }

        // One request carries the whole clip, so the limit is the single-request one (larger clips use the chunked route).
        const stored = await storeVideoUpload(c.env, claims, file, MAX_FORM_VIDEO_BYTES);
        if (!stored.ok) return c.json({ error: stored.error }, stored.status);

        return c.json({ success: true, data: { mediaId: stored.mediaId, r2Key: stored.r2Key } }, 200);
    });

    /**
     * POST /:id/media/video/r2-upload-poster
     *
     * Token-gated poster upload to R2 (jpeg, png or webp, up to the photo size cap).
     * The same upload token used for the
     * video clip is reused (same mediaId, tenant, inspection guard). The poster
     * is stored at a stable key derived from mediaId. Returns { posterKey } for
     * the client to include in the finalize ref.
     */
    router.post('/:id/media/video/r2-upload-poster', async (c) => {
        const id = c.req.param('id');
        const tenantId = c.get('tenantId');

        const tokenStr = c.req.query('token') ?? '';
        const claims = await verifyUploadToken(tokenStr, c.env.JWT_SECRET);
        if (!claims || claims.inspectionId !== id || claims.tenantId !== tenantId) {
            return c.json({ error: 'Invalid or expired upload token' }, 401);
        }

        // The poster belongs to a clip that was uploaded under this token: refuse one for a media id with no clip.
        const clips = await Promise.all([...new Set(Object.values(MIME_TO_EXT))].map((ext) => r2Head(c.env.PHOTOS, r2Keys.inspectionVideo(tenantId, id, claims.mediaId, ext))));
        if (clips.every((clip) => clip === null)) {
            return c.json({ error: 'No uploaded video for this upload token' }, 404);
        }

        const formData = await c.req.parseBody();
        const file = formData['file'] as File | undefined;
        if (!file) {
            return c.json({ error: 'file field required' }, 400);
        }

        if (file.size > MAX_PHOTO_BYTES) {
            return c.json({ error: 'Poster is too large.' }, 413);
        }
        const mime = sniffPosterType(await headBytes(file));
        if (!mime) {
            return c.json({ error: 'Missing or unsupported poster type. Allowed: jpeg, png, webp.' }, 400);
        }

        const { mediaId } = claims;
        const posterKey = r2Keys.inspectionVideoPoster(tenantId, claims.inspectionId, mediaId);

        const bytes = await file.arrayBuffer();
        try {
            await r2Put(c.env.PHOTOS, posterKey, bytes, {
                httpMetadata: { contentType: mime },
                customMetadata: { tenantId, inspectionId: claims.inspectionId, mediaId },
            });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            logger.error('R2 poster put failed', { tenantId, inspectionId: id, mediaId, posterKey }, err instanceof Error ? err : undefined);
            if (/quota|storage|capacity|exceeded/i.test(detail)) {
                throw Errors.ServiceUnavailable('Video storage is full — free up R2 space or enable Stream.');
            }
            throw err;
        }

        logger.info('r2-upload-poster: stored poster', {
            tenantId, inspectionId: id, mediaId, posterKey,
        });

        return c.json({ success: true, data: { posterKey } }, 200);
    });

    /**
     * GET /:id/media/video/r2-object/:mediaId
     *
     * Serve an R2 video with HTTP Range support. Tenant-guarded: the pool row
     * must exist for (mediaId, tenantId, provider='r2') before any bytes are
     * served. Returns 206 for Range requests, 200 for full-object requests.
     */
    router.get('/:id/media/video/r2-object/:mediaId', async (c) => {
        const tenantId = c.get('tenantId');
        const mediaId = c.req.param('mediaId');

        const db = getDrizzle(c);
        const row = await db
            .select({ r2Key: inspectionMediaPool.r2Key })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.inspectionId, c.req.param('id')),
                eq(inspectionMediaPool.tenantId, tenantId),
                eq(inspectionMediaPool.provider, 'r2'),
                eq(inspectionMediaPool.mediaType, 'video'),
            ))
            .get();

        const clipKey = row && ownClipKey(row.r2Key, tenantId, c.req.param('id'));
        if (!clipKey) {
            return c.json({ error: 'Video not found' }, 404);
        }

        const served = await serveVideoClip(c.env.PHOTOS, clipKey, c.req.header('Range'), STAFF_VIDEO_CACHE);
        return served ?? c.json({ error: 'Video not found in storage' }, 404);
    });

    /**
     * GET /:id/media/video/r2-object/:mediaId/poster
     *
     * Serve the poster JPEG for an R2 video. Tenant-guarded via pool row lookup.
     * Cached privately for a day — poster images are immutable once finalized.
     */
    router.get('/:id/media/video/r2-object/:mediaId/poster', async (c) => {
        const tenantId = c.get('tenantId');
        const mediaId = c.req.param('mediaId');

        const db = getDrizzle(c);
        const row = await db
            .select({ r2Key: inspectionMediaPool.r2Key, posterKey: inspectionMediaPool.posterKey })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.inspectionId, c.req.param('id')),
                eq(inspectionMediaPool.tenantId, tenantId),
                eq(inspectionMediaPool.provider, 'r2'),
            ))
            .get();

        const posterKey = row && ownPosterKey(row, tenantId);
        if (!posterKey) {
            return c.json({ error: 'Poster not found' }, 404);
        }

        const served = await serveVideoPoster(c.env.PHOTOS, posterKey, STAFF_VIDEO_CACHE);
        return served ?? c.json({ error: 'Poster not found in storage' }, 404);
    });
}
