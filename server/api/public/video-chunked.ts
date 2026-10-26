/**
 * Token-only chunked video upload, mounted under `/api/public/uploads/video/chunked`.
 *
 *   POST   /                open the upload for this token (or return it, with the parts received so far)
 *   PUT    /parts/{n}       one part, raw bytes; exactly the size the upload fixes for that part
 *   POST   /complete        join the parts into the video; repeating it answers the same result
 *   DELETE /                cancel an unfinished upload
 *
 * Like the single-request routes in `uploads.ts`, these carry no session: a background transfer can
 * outlive the access token that started it. What they trust is the signed upload token minted for ONE
 * inspection and ONE media id by an authenticated native session. Tenant, inspection, media id and
 * issuer come from that token, the issuer must still be an active member, and everything else about
 * the upload (size, part size, key, stored type) is read from the server's own ledger row, never from
 * the request. The native-client switch is checked by the `/uploads/*` middleware in `uploads.ts`.
 *
 * Plain Hono (not OpenAPI): the part route carries a binary body, and the surface is pinned by the
 * native contract's non-OpenAPI registry instead.
 */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';
import type { HonoConfig } from '../../types/hono';
import { verifyUploadToken } from '../../lib/video-upload-token';
import { inspections } from '../../lib/db/schema';
import { getDrizzle } from '../../lib/route-helpers';
import { currentNativeRole } from '../../lib/auth/native-token';
import { readBoundedBody } from '../../lib/bounded-body';
import { OpenChunkedVideoUploadSchema } from '../../lib/validations/video-chunked.schema';
import { abort, complete, createOrResume, planPart, storePart, type UploadFailure, type UploadScope } from '../../services/video/chunked-upload.service';
import { logger } from '../../lib/logger';

const INVALID_TOKEN = { error: 'Invalid or expired upload token', code: 'INVALID_UPLOAD_TOKEN' } as const;

/** The scope of the verified token, or the response that refuses it. The issuer must still be an active member. */
async function authorize(c: Context<HonoConfig>, opts: { inspection: boolean }): Promise<UploadScope | Response> {
    const claims = await verifyUploadToken(c.req.query('token') ?? '', c.env.JWT_SECRET, 'video');
    // A token minted before issuers were recorded cannot use the chunked path.
    if (!claims || !claims.userId) return c.json(INVALID_TOKEN, 401);
    if (!(await currentNativeRole(c.env.DB, claims.userId, claims.tenantId))) return c.json(INVALID_TOKEN, 401);
    if (opts.inspection) {
        const row = await getDrizzle(c).select({ id: inspections.id }).from(inspections)
            .where(and(eq(inspections.id, claims.inspectionId), eq(inspections.tenantId, claims.tenantId))).get();
        if (!row) return c.json({ error: 'Inspection not found.', code: 'INSPECTION_NOT_FOUND' }, 404);
    }
    return { tenantId: claims.tenantId, inspectionId: claims.inspectionId, mediaId: claims.mediaId, userId: claims.userId, exp: claims.exp };
}

const refuse = (c: Context<HonoConfig>, f: UploadFailure): Response =>
    c.json({ error: f.error, code: f.code, ...f.extra }, f.status);

export const videoChunkedRoutes = new Hono<HonoConfig>()
    .post('/', async (c) => {
        const scope = await authorize(c, { inspection: true });
        if (scope instanceof Response) return scope;
        const body = OpenChunkedVideoUploadSchema.safeParse(await c.req.json().catch(() => null));
        if (!body.success) return c.json({ error: 'totalBytes must be a positive integer.', code: 'VALIDATION_ERROR' }, 400);
        const opened = await createOrResume(getDrizzle(c), scope, body.data.totalBytes);
        return opened.ok ? c.json({ success: true, data: opened.session }, 200) : refuse(c, opened);
    })
    .put('/parts/:n', async (c) => {
        const scope = await authorize(c, { inspection: false });
        if (scope instanceof Response) return scope;
        const raw = c.req.param('n');
        if (!/^\d{1,5}$/.test(raw)) return c.json({ error: 'No such part.', code: 'VIDEO_PART_NOT_FOUND' }, 404);
        const n = Number(raw);
        const db = getDrizzle(c);
        const plan = await planPart(db, scope, n);
        if (!plan.ok) return refuse(c, plan);
        // The size comes from the ledger, and is checked before one byte of the body is read.
        const declared = c.req.header('content-length');
        if (declared === undefined) return c.json({ error: 'Content-Length is required.', code: 'LENGTH_REQUIRED' }, 411);
        if (!/^\d+$/.test(declared.trim()) || Number(declared) !== plan.expected) {
            return c.json({ error: `Part ${n} must be exactly ${plan.expected} bytes.`, code: 'VIDEO_PART_SIZE_MISMATCH' }, 413);
        }
        const body = await readBoundedBody(c.req.raw, plan.expected, 400);
        if (!body.ok) return c.json({ error: 'The part body does not match its declared length.', code: 'VIDEO_PART_SIZE_MISMATCH' }, body.status);
        const stored = await storePart(db, c.env.PHOTOS, scope, plan.row, n, body.bytes);
        if (!stored.ok) return refuse(c, stored);
        return c.json({ success: true, data: { partNumber: stored.partNumber, size: stored.size } }, 200);
    })
    .post('/complete', async (c) => {
        const scope = await authorize(c, { inspection: true });
        if (scope instanceof Response) return scope;
        const done = await complete(getDrizzle(c), c.env.PHOTOS, scope);
        if (!done.ok) return refuse(c, done);
        logger.info('public-upload: completed chunked video', { tenantId: scope.tenantId, inspectionId: scope.inspectionId, mediaId: scope.mediaId });
        return c.json({ success: true, data: { mediaId: done.mediaId, r2Key: done.r2Key } }, 200);
    })
    .delete('/', async (c) => {
        const scope = await authorize(c, { inspection: false });
        if (scope instanceof Response) return scope;
        const aborted = await abort(getDrizzle(c), c.env.PHOTOS, scope);
        return aborted.ok ? c.body(null, 204) : refuse(c, aborted);
    });
