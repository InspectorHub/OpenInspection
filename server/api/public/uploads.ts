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
 * A token can outlive what it was minted for, so before any byte is read the
 * route re-checks, scoped to the token's tenant, that the inspection still
 * exists (a deleted inspection's storage was already swept; a late upload would
 * be an orphan nobody cleans up) and that the member who minted it is still an
 * active member. A photo token must name that member; a video token minted
 * before the field existed gets the inspection check only.
 *
 * The request must declare its length (411 otherwise) so an oversized body is
 * refused (413) before it is buffered.
 *
 * Plain Hono (not OpenAPI), like the other raw multipart routes: the body is a
 * binary stream and the surface is not part of the MCP tool contract.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../../types/hono';
import { verifyUploadToken, type UploadTokenClaims } from '../../lib/video-upload-token';
import { inspections } from '../../lib/db/schema';
import { getDrizzle } from '../../lib/route-helpers';
import { currentNativeRole } from '../../lib/auth/native-token';
import { nativeClientEnabled } from '../../lib/mcp/flag';
import { r2Keys } from '../../lib/r2-keys';
import { logger } from '../../lib/logger';
import { imagesBinding } from '../../lib/media/serve-photo';
import { MAX_PHOTO_BYTES, isSignedPhotoExt, signedPhotoExtFor, storePhotoAtKey } from '../../lib/media/store-photo';
import { MAX_VIDEO_BYTES, storeVideoUpload } from '../inspections/media-video-r2';

/** Multipart framing adds a little to the file itself; this much headroom is allowed before the body is read. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

const INVALID_TOKEN = { error: 'Invalid or expired upload token' } as const;

/**
 * Refuse a body that does not declare its size, or declares too much, before it
 * is read into memory. A missing or non-numeric length is 411 rather than zero:
 * a chunked body has no declared size to check.
 */
function checkDeclaredLength(c: Context<HonoConfig>, maxBytes: number, tooLarge: string): Response | null {
    const header = c.req.header('content-length');
    if (header === undefined || !/^\d+$/.test(header.trim())) {
        return c.json({ error: 'Content-Length is required.' }, 411);
    }
    return Number(header) > maxBytes + MULTIPART_OVERHEAD_BYTES ? c.json({ error: tooLarge }, 413) : null;
}

/** The token's issuer is still an active member and its inspection still exists, both in the token's tenant. */
async function checkDestination(c: Context<HonoConfig>, claims: UploadTokenClaims): Promise<Response | null> {
    if (claims.userId && !(await currentNativeRole(c.env.DB, claims.userId, claims.tenantId))) {
        return c.json(INVALID_TOKEN, 401);
    }
    const row = await getDrizzle(c).select({ id: inspections.id }).from(inspections)
        .where(and(eq(inspections.id, claims.inspectionId), eq(inspections.tenantId, claims.tenantId))).get();
    return row ? null : c.json({ error: 'Inspection not found.' }, 404);
}

async function readFile(c: Context<HonoConfig>): Promise<File | null> {
    const form = await c.req.parseBody();
    const file = form['file'];
    return file instanceof File ? file : null;
}

export const publicUploadsRoutes = new Hono<HonoConfig>()
    // These routes exist for native clients only (the web editor is handed its
    // session URL). A token minted while the switch was on outlives it by up to
    // 24 hours, so the switch is checked here, not only when the URL is minted.
    .use('/uploads/*', async (c, next) => {
        if (!nativeClientEnabled(c.env)) return c.json({ error: 'Not found' }, 404);
        return next();
    })
    .post('/uploads/photo', async (c) => {
        const claims = await verifyUploadToken(c.req.query('token') ?? '', c.env.JWT_SECRET, 'photo');
        if (!claims || !claims.userId || !isSignedPhotoExt(claims.ext)) return c.json(INVALID_TOKEN, 401);

        const refusedLength = checkDeclaredLength(c, MAX_PHOTO_BYTES, 'Photo is too large.');
        if (refusedLength) return refusedLength;
        const refusedDestination = await checkDestination(c, claims);
        if (refusedDestination) return refusedDestination;
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

        const refusedLength = checkDeclaredLength(c, MAX_VIDEO_BYTES, 'Video is too large.');
        if (refusedLength) return refusedLength;
        const refusedDestination = await checkDestination(c, claims);
        if (refusedDestination) return refusedDestination;
        const file = await readFile(c);
        if (!file) return c.json({ error: 'file field required' }, 400);

        const stored = await storeVideoUpload(c.env, claims, file);
        if (!stored.ok) return c.json({ error: stored.error }, stored.status);
        return c.json({ success: true, data: { mediaId: stored.mediaId, r2Key: stored.r2Key } }, 200);
    });
