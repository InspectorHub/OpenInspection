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
import { drizzle } from 'drizzle-orm/d1';
import { inspectionMediaPool } from '../../lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { verifyUploadToken } from '../../lib/video-upload-token';
import { r2Keys } from '../../lib/r2-keys';
import { logger } from '../../lib/logger';
import { Errors } from '../../lib/errors';
import type { HonoConfig } from '../../types/hono';

// ── MIME / extension helpers ─────────────────────────────────────────────────

const MIME_TO_EXT: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
};

export function mimeToExt(mime: string): string {
    return MIME_TO_EXT[mime] ?? 'mp4';
}

export const ALLOWED_VIDEO_MIMES = new Set(Object.keys(MIME_TO_EXT));
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024; // 200 MB

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

        const formData = await c.req.parseBody();
        const file = formData['file'] as File | undefined;
        if (!file) {
            return c.json({ error: 'file field required' }, 400);
        }

        const mime = file.type;
        if (!mime || !ALLOWED_VIDEO_MIMES.has(mime)) {
            return c.json({ error: 'Missing or unsupported video type. Allowed: mp4, mov, webm.' }, 400);
        }

        if (file.size > MAX_VIDEO_BYTES) {
            return c.json({ error: `File exceeds the 200 MB limit (got ${Math.round(file.size / 1024 / 1024)} MB).` }, 413);
        }

        const { mediaId } = claims;
        const ext = mimeToExt(mime);
        // Use inspectionId from the trusted token (never the URL param) for the key.
        const r2Key = r2Keys.inspectionVideo(tenantId, claims.inspectionId, mediaId, ext);

        const bytes = await file.arrayBuffer();
        try {
            await c.env.PHOTOS.put(r2Key, bytes, {
                httpMetadata: { contentType: mime },
                customMetadata: { tenantId, inspectionId: claims.inspectionId, mediaId },
            });
        } catch (err) {
            const detail = err instanceof Error ? err.message : String(err);
            logger.error('R2 video put failed', { tenantId, inspectionId: id, mediaId, r2Key }, err instanceof Error ? err : undefined);
            if (/quota|storage|capacity|exceeded/i.test(detail)) {
                throw Errors.ServiceUnavailable('Video storage is full — free up R2 space or enable Stream.');
            }
            throw err;
        }

        logger.info('r2-upload: stored video', {
            tenantId, inspectionId: id, mediaId, r2Key, bytes: bytes.byteLength,
        });

        return c.json({ success: true, data: { mediaId, r2Key } }, 200);
    });

    /**
     * POST /:id/media/video/r2-upload-poster
     *
     * Token-gated JPEG poster upload to R2. The same upload token used for the
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

        const formData = await c.req.parseBody();
        const file = formData['file'] as File | undefined;
        if (!file) {
            return c.json({ error: 'file field required' }, 400);
        }

        const mime = file.type;
        if (!mime || !mime.startsWith('image/')) {
            return c.json({ error: 'Missing or unsupported poster type. JPEG image required.' }, 400);
        }

        const { mediaId } = claims;
        const posterKey = r2Keys.inspectionVideoPoster(tenantId, claims.inspectionId, mediaId);

        const bytes = await file.arrayBuffer();
        try {
            await c.env.PHOTOS.put(posterKey, bytes, {
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

        const db = drizzle(c.env.DB);
        const row = await db
            .select({ r2Key: inspectionMediaPool.r2Key })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.tenantId, tenantId),
                eq(inspectionMediaPool.provider, 'r2'),
                eq(inspectionMediaPool.mediaType, 'video'),
            ))
            .get();

        if (!row) {
            return c.json({ error: 'Video not found' }, 404);
        }

        const rangeHeader = c.req.header('Range');

        if (rangeHeader) {
            const rangeMatch = /^bytes=(\d+)-(\d*)$/.exec(rangeHeader.trim());
            if (!rangeMatch) {
                return c.json({ error: 'Invalid Range header' }, 416);
            }
            const start = parseInt(rangeMatch[1], 10);
            const endStr = rangeMatch[2];

            const obj = await c.env.PHOTOS.get(row.r2Key, {
                range: endStr
                    ? { offset: start, length: parseInt(endStr, 10) - start + 1 }
                    : { offset: start },
            });

            if (!obj) {
                return c.json({ error: 'Video not found in storage' }, 404);
            }

            const contentType = obj.httpMetadata?.contentType ?? 'video/mp4';
            const end = endStr ? parseInt(endStr, 10) : (obj.size - 1);
            const contentLength = end - start + 1;

            return new Response(obj.body, {
                status: 206,
                headers: {
                    'Content-Type': contentType,
                    'Content-Range': `bytes ${start}-${end}/${obj.size}`,
                    'Content-Length': String(contentLength),
                    'Accept-Ranges': 'bytes',
                },
            });
        }

        // Full-object request.
        const obj = await c.env.PHOTOS.get(row.r2Key);
        if (!obj) {
            return c.json({ error: 'Video not found in storage' }, 404);
        }

        const contentType = obj.httpMetadata?.contentType ?? 'video/mp4';

        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(obj.size),
                'Accept-Ranges': 'bytes',
            },
        });
    });

    /**
     * GET /:id/media/video/r2-object/:mediaId/poster
     *
     * Serve the poster JPEG for an R2 video. Tenant-guarded via pool row lookup.
     * Long-lived cache (1 day) — poster images are immutable once finalized.
     */
    router.get('/:id/media/video/r2-object/:mediaId/poster', async (c) => {
        const tenantId = c.get('tenantId');
        const mediaId = c.req.param('mediaId');

        const db = drizzle(c.env.DB);
        const row = await db
            .select({ posterKey: inspectionMediaPool.posterKey })
            .from(inspectionMediaPool)
            .where(and(
                eq(inspectionMediaPool.id, mediaId),
                eq(inspectionMediaPool.tenantId, tenantId),
                eq(inspectionMediaPool.provider, 'r2'),
            ))
            .get();

        if (!row || !row.posterKey) {
            return c.json({ error: 'Poster not found' }, 404);
        }

        const obj = await c.env.PHOTOS.get(row.posterKey);
        if (!obj) {
            return c.json({ error: 'Poster not found in storage' }, 404);
        }

        const contentType = obj.httpMetadata?.contentType ?? 'image/jpeg';

        return new Response(obj.body, {
            status: 200,
            headers: {
                'Content-Type': contentType,
                'Content-Length': String(obj.size),
                'Cache-Control': 'public, max-age=86400',
            },
        });
    });
}
