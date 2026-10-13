/**
 * Token-only upload routes for background uploads from a native client.
 *
 *   POST /api/public/uploads/photo?token=   multipart field "file"
 *   POST /api/public/uploads/video?token=   multipart field "file"
 *
 * A background transfer can outlive the access token that started it, so these
 * routes carry no session. What they trust instead is a signed upload token
 * (server/lib/video-upload-token.ts) that an authenticated native session
 * minted for ONE inspection and ONE media id. Tenant, inspection, media id and
 * the file extension all come from the verified token; nothing in the query
 * string or the body can name another destination. A photo token is refused by
 * the video route and the reverse, and a tampered or expired token is a 401.
 *
 * The object key is a pure function of the token, so sending the same token
 * twice overwrites one object instead of adding another.
 *
 * Plain Hono (not OpenAPI), like the other raw multipart routes: the body is a
 * binary stream and the surface is not part of the MCP tool contract.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import type { HonoConfig } from '../../types/hono';
import { verifyUploadToken } from '../../lib/video-upload-token';
import { r2Keys } from '../../lib/r2-keys';
import { logger } from '../../lib/logger';
import { imagesBinding } from '../../lib/media/serve-photo';
import { MAX_PHOTO_BYTES, isSignedPhotoExt, signedPhotoExtFor, storePhotoAtKey } from '../../lib/media/store-photo';
import { MAX_VIDEO_BYTES, storeVideoUpload } from '../inspections/media-video-r2';

/** Multipart framing adds a little to the file itself; this much headroom is allowed before the body is read. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const INVALID_TOKEN = { error: 'Invalid or expired upload token' } as const;

/** Refuse an oversized body before reading it into memory. */
function declaredLength(c: Context<HonoConfig>): number {
    const n = Number(c.req.header('content-length') ?? '0');
    return Number.isFinite(n) ? n : 0;
}

async function readFile(c: Context<HonoConfig>): Promise<File | null> {
    const form = await c.req.parseBody();
    const file = form['file'];
    return file instanceof File ? file : null;
}

export const publicUploadsRoutes = new Hono<HonoConfig>()
    .post('/uploads/photo', async (c) => {
        const claims = await verifyUploadToken(c.req.query('token') ?? '', c.env.JWT_SECRET, 'photo');
        if (!claims || !isSignedPhotoExt(claims.ext)) return c.json(INVALID_TOKEN, 401);

        if (declaredLength(c) > MAX_PHOTO_BYTES + MULTIPART_OVERHEAD_BYTES) {
            return c.json({ error: 'Photo is too large.' }, 413);
        }
        const file = await readFile(c);
        if (!file) return c.json({ error: 'file field required' }, 400);
        if (file.size > MAX_PHOTO_BYTES) return c.json({ error: 'Photo is too large.' }, 413);
        // The declared type must be the one the URL was minted for: the key's
        // extension was fixed at issue time and the stored type has to agree.
        if (signedPhotoExtFor(file.type) !== claims.ext) {
            return c.json({ error: 'Missing or unsupported photo type. Allowed: jpeg, png, heic.' }, 400);
        }

        const key = r2Keys.inspectionPhoto(claims.tenantId, claims.inspectionId, claims.mediaId, claims.ext);
        await storePhotoAtKey(c.env.PHOTOS, imagesBinding(c.env), key, file);
        logger.info('public-upload: stored photo', {
            tenantId: claims.tenantId, inspectionId: claims.inspectionId, mediaId: claims.mediaId, key,
        });
        return c.json({ success: true, data: { key } }, 200);
    })
    .post('/uploads/video', async (c) => {
        const claims = await verifyUploadToken(c.req.query('token') ?? '', c.env.JWT_SECRET, 'video');
        if (!claims) return c.json(INVALID_TOKEN, 401);

        if (declaredLength(c) > MAX_VIDEO_BYTES + MULTIPART_OVERHEAD_BYTES) {
            return c.json({ error: 'Video is too large.' }, 413);
        }
        const file = await readFile(c);
        if (!file) return c.json({ error: 'file field required' }, 400);

        const stored = await storeVideoUpload(c.env, claims, file);
        if (!stored.ok) return c.json({ error: stored.error }, stored.status);
        return c.json({ success: true, data: { mediaId: stored.mediaId, r2Key: stored.r2Key } }, 200);
    });
