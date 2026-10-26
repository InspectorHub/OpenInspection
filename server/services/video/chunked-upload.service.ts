/**
 * Chunked (multipart) video upload to object storage, kept honest by a D1 ledger.
 *
 * The storage binding cannot list the parts of an unfinished upload and the native client never
 * sees a part's tag, so every fact about an upload lives in `video_uploads` / `video_upload_parts`
 * and every request is checked against the ledger row found by `(tenantId, mediaId)`, both taken
 * from the verified upload token. Nothing in a request can name a key, an upload id, a type or a
 * size: they are fixed when the upload is created (size, part size) or when its first part is
 * read (stored type, key extension, storage upload).
 *
 * Parts are a fixed size (`VIDEO_PART_BYTES`) except the last, which is whatever remains. Storage
 * requires every part but the last to be one size and at least 5 MiB, so the size a part must have
 * is computed here and a part of any other size is refused before its body is read.
 *
 * Needs a real-storage smoke check (the local runtime does not enforce them): the 5 MiB minimum,
 * a single-part upload, and the error text of an invalid or vanished upload (`classify`).
 */
import { and, asc, count, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { AppDrizzle } from '../../lib/route-helpers';
import { videoUploads, videoUploadParts, type VideoUpload } from '../../lib/db/schema';
import { r2CreateMultipart, r2Delete, r2Head, r2ResumeMultipart } from '../../lib/r2/objects';
import { r2Keys } from '../../lib/r2-keys';
import { HEAD_BYTES, headBytes, sniffVideoType } from '../../lib/media/sniff';
import { MAX_OPEN_VIDEO_UPLOADS, MAX_VIDEO_BYTES, VIDEO_PART_BYTES, mimeToExt } from '../../lib/media/video-types';
import { logger } from '../../lib/logger';

export { VIDEO_PART_BYTES, MAX_OPEN_VIDEO_UPLOADS };
/** The ledger row outlives its token by this long, so a replayed token still finds it. */
const EXPIRY_GRACE_MS = 60 * 60 * 1000;
/** A row in `completing` for longer than this was left by a request that died; the object itself says how it ended. */
const STUCK_COMPLETING_MS = 60 * 1000;
/** Fewest bytes a video can be and still be recognised by its first bytes. */
const MIN_VIDEO_BYTES = 16;

export interface UploadScope {
    tenantId: string;
    inspectionId: string;
    mediaId: string;
    userId: string;
    /** The token's expiry, in epoch seconds. */
    exp: number;
}

export interface UploadFailure {
    ok: false;
    status: 400 | 404 | 409 | 410 | 413 | 429;
    code: string;
    error: string;
    extra?: Record<string, unknown>;
}
export type UploadResult<T> = ({ ok: true } & T) | UploadFailure;

const fail = (status: UploadFailure['status'], code: string, error: string, extra?: Record<string, unknown>): UploadFailure =>
    ({ ok: false, status, code, error, ...(extra ? { extra } : {}) });

const NOT_FOUND = fail(404, 'VIDEO_UPLOAD_NOT_FOUND', 'No such upload.');
const GONE = fail(410, 'VIDEO_UPLOAD_GONE', 'This upload was aborted or failed; start a new one.');
const BUSY = fail(409, 'VIDEO_UPLOAD_BUSY', 'This upload is being completed.');
const DONE = fail(409, 'VIDEO_ALREADY_COMPLETED', 'This upload is already complete.');

/** The refusal for a row that is not accepting parts, or null when it is open. */
function notOpen(row: VideoUpload): UploadFailure | null {
    if (row.state === 'open') return null;
    if (row.state === 'completing') return BUSY;
    return row.state === 'completed' ? DONE : GONE;
}

/** What storage's multipart errors look like; the codes are R2's documented ones, the names are what the binding throws. */
function classify(err: unknown): 'invalid-part' | 'no-such-upload' | 'other' {
    const text = err instanceof Error ? err.message : String(err);
    if (/InvalidPart|\b10025\b|\b10048\b/i.test(text)) return 'invalid-part';
    if (/NoSuchUpload|\b10024\b/i.test(text)) return 'no-such-upload';
    return 'other';
}

const byScope = (scope: Pick<UploadScope, 'tenantId' | 'mediaId'>) =>
    and(eq(videoUploads.tenantId, scope.tenantId), eq(videoUploads.mediaId, scope.mediaId));

export const partsOf = (scope: Pick<UploadScope, 'tenantId' | 'mediaId'>) =>
    and(eq(videoUploadParts.tenantId, scope.tenantId), eq(videoUploadParts.mediaId, scope.mediaId));

async function loadRow(db: AppDrizzle, scope: Pick<UploadScope, 'tenantId' | 'mediaId'>): Promise<VideoUpload | undefined> {
    return db.select().from(videoUploads).where(byScope(scope)).get();
}

/** Move an open row to `state`; false when it was no longer open (someone else got there first). */
export async function leaveOpen(
    db: AppDrizzle, scope: Pick<UploadScope, 'tenantId' | 'mediaId'>, from: 'open' | 'completing', state: VideoUpload['state'],
    stamp: { completedAt?: Date; completingAt?: Date } = {},
): Promise<boolean> {
    const moved = await db.update(videoUploads)
        .set({ state, ...stamp })
        .where(and(byScope(scope), eq(videoUploads.state, from)))
        .returning({ id: videoUploads.id }).all();
    return moved.length > 0;
}

/** Best effort: abort the storage upload so no unfinished parts are left to bill. */
export async function abortStorage(bucket: R2Bucket, row: Pick<VideoUpload, 'r2Key' | 'uploadId'>): Promise<void> {
    if (!row.r2Key || !row.uploadId) return;
    try {
        await r2ResumeMultipart(bucket, row.r2Key, row.uploadId).abort();
    } catch (err) {
        if (classify(err) !== 'no-such-upload') logger.warn('video-chunked: abort failed', { r2Key: row.r2Key, error: err instanceof Error ? err.message : String(err) });
    }
}

async function receivedParts(db: AppDrizzle, scope: UploadScope): Promise<{ partNumber: number; size: number }[]> {
    const rows = await db.select({ partNumber: videoUploadParts.partNumber, size: videoUploadParts.sizeBytes })
        .from(videoUploadParts).where(partsOf(scope)).orderBy(asc(videoUploadParts.partNumber)).all();
    return rows;
}

const isStuck = (row: Pick<VideoUpload, 'completingAt'>, now: Date): boolean =>
    !row.completingAt || now.getTime() - row.completingAt.getTime() > STUCK_COMPLETING_MS;

/**
 * Settle a row in `completing` by looking at the object. The object is the truth: a request that died after
 * storage joined it left the row behind, and a lost answer leaves no other trace. An object of another size
 * than declared ends the upload but is NOT deleted here (the key could have been written by another route).
 */
export async function settleCompleting(
    db: AppDrizzle, bucket: R2Bucket, row: VideoUpload, now: Date,
): Promise<'completed' | 'absent' | 'wrong-size'> {
    const found = row.r2Key ? await r2Head(bucket, row.r2Key) : null;
    if (!found) return 'absent';
    if (found.size !== row.totalBytes) {
        logger.error('video-chunked: stored object is not the declared size', { tenantId: row.tenantId, mediaId: row.mediaId, declared: row.totalBytes, stored: found.size });
        await leaveOpen(db, row, 'completing', 'failed');
        await db.delete(videoUploadParts).where(partsOf(row));
        return 'wrong-size';
    }
    await leaveOpen(db, row, 'completing', 'completed', { completedAt: now });
    await db.delete(videoUploadParts).where(partsOf(row));
    return 'completed';
}

const SIZE_MISMATCH = fail(400, 'VIDEO_SIZE_MISMATCH', 'The stored video is not the size that was declared.');

/** The bytes part `n` must have: a full part, or what remains for the last one. */
const expectedPartSize = (row: Pick<VideoUpload, 'totalBytes' | 'partBytes' | 'partCount'>, n: number): number =>
    n < row.partCount ? row.partBytes : row.totalBytes - (row.partCount - 1) * row.partBytes;

export interface UploadSession {
    state: VideoUpload['state'];
    mediaId: string;
    totalBytes: number;
    partBytes: number;
    partCount: number;
    r2Key: string | null;
    received: { partNumber: number; size: number }[];
}

/** Open an upload for this token, or return the one already open (so a client can resume by asking again). */
export async function createOrResume(
    db: AppDrizzle, scope: UploadScope, totalBytes: number, now: Date = new Date(),
): Promise<UploadResult<{ session: UploadSession }>> {
    if (totalBytes > MAX_VIDEO_BYTES) {
        return fail(413, 'VIDEO_TOO_LARGE', 'Video is too large.', { limits: { maxBytes: MAX_VIDEO_BYTES } });
    }
    if (totalBytes < MIN_VIDEO_BYTES) return fail(400, 'VIDEO_FORMAT_MISMATCH', 'Too small to be a video.');

    let row = await loadRow(db, scope);
    if (!row) {
        const counted = await db.select({ open: count() }).from(videoUploads).where(and(
            eq(videoUploads.tenantId, scope.tenantId), eq(videoUploads.userId, scope.userId),
            inArray(videoUploads.state, ['open', 'completing']), gt(videoUploads.expiresAt, now),
        )).get();
        if ((counted?.open ?? 0) >= MAX_OPEN_VIDEO_UPLOADS) {
            return fail(429, 'VIDEO_TOO_MANY_OPEN', 'Too many uploads in progress; finish or abort one first.');
        }
        // A concurrent first call for the same token inserts nothing here and reads the winner's row below.
        await db.insert(videoUploads).values({
            id: crypto.randomUUID(), tenantId: scope.tenantId, inspectionId: scope.inspectionId, mediaId: scope.mediaId,
            userId: scope.userId, totalBytes, partBytes: VIDEO_PART_BYTES, partCount: Math.ceil(totalBytes / VIDEO_PART_BYTES),
            state: 'open', createdAt: now, expiresAt: new Date(scope.exp * 1000 + EXPIRY_GRACE_MS),
        }).onConflictDoNothing();
        row = await loadRow(db, scope);
    }
    if (!row) return GONE;
    if (row.state === 'aborted' || row.state === 'failed') return GONE;
    if (row.totalBytes !== totalBytes) {
        return fail(409, 'VIDEO_UPLOAD_PARAMS_MISMATCH', 'This upload was opened with a different size.');
    }
    return {
        ok: true,
        session: {
            state: row.state, mediaId: row.mediaId, totalBytes: row.totalBytes, partBytes: row.partBytes,
            partCount: row.partCount, r2Key: row.state === 'completed' ? row.r2Key : null,
            received: row.state === 'completed' ? [] : await receivedParts(db, scope),
        },
    };
}

/** What a part request is checked against before its body is read. */
export async function planPart(db: AppDrizzle, scope: UploadScope, n: number): Promise<UploadResult<{ row: VideoUpload; expected: number }>> {
    const row = await loadRow(db, scope);
    if (!row) return NOT_FOUND;
    const refused = notOpen(row);
    if (refused) return refused;
    if (!Number.isInteger(n) || n < 1 || n > row.partCount) return fail(404, 'VIDEO_PART_NOT_FOUND', 'No such part.');
    // The type and key come from part 1's own bytes, so the storage upload only exists once part 1 was read.
    if (n > 1 && !row.uploadId) return fail(409, 'VIDEO_FIRST_PART_REQUIRED', 'Send part 1 first.');
    return { ok: true, row, expected: expectedPartSize(row, n) };
}

/** Refuse an upload for good: nothing is left in storage and the ledger row stops accepting parts. */
async function refuseFormat(db: AppDrizzle, bucket: R2Bucket, scope: UploadScope, row: VideoUpload): Promise<UploadFailure> {
    await leaveOpen(db, scope, 'open', 'failed');
    await abortStorage(bucket, row);
    await db.delete(videoUploadParts).where(partsOf(scope));
    return fail(400, 'VIDEO_FORMAT_MISMATCH', 'Missing or unsupported video type. Allowed: mp4, mov, webm.');
}

/** Part 1 only: read its first bytes, fix the stored type and key, and open the storage upload if it is not open yet. */
async function openOnFirstPart(db: AppDrizzle, bucket: R2Bucket, scope: UploadScope, row: VideoUpload, bytes: Uint8Array): Promise<UploadResult<{ row: VideoUpload }>> {
    const type = sniffVideoType(await headBytes(new Blob([bytes.subarray(0, HEAD_BYTES)])));
    if (!type || (row.contentType && row.contentType !== type)) return refuseFormat(db, bucket, scope, row);
    if (row.uploadId) return { ok: true, row };

    const r2Key = r2Keys.inspectionVideo(scope.tenantId, scope.inspectionId, scope.mediaId, mimeToExt(type));
    const mine = await r2CreateMultipart(bucket, r2Key, {
        httpMetadata: { contentType: type },
        customMetadata: { tenantId: scope.tenantId, inspectionId: scope.inspectionId, mediaId: scope.mediaId },
    });
    const claimed = await db.update(videoUploads).set({ uploadId: mine.uploadId, r2Key, contentType: type })
        .where(and(byScope(scope), eq(videoUploads.state, 'open'), isNull(videoUploads.uploadId)))
        .returning({ id: videoUploads.id }).all();
    if (claimed.length === 0) {
        // Another request opened it first (or the upload ended meanwhile): drop ours and use theirs.
        await mine.abort().catch(() => undefined);
        const current = await loadRow(db, scope);
        return current?.uploadId && current.state === 'open' ? { ok: true, row: current } : GONE;
    }
    return { ok: true, row: { ...row, uploadId: mine.uploadId, r2Key, contentType: type } };
}

/** Store part `n` (already length-checked against `planPart`) and record its tag. Re-sending a part replaces it. */
export async function storePart(
    db: AppDrizzle, bucket: R2Bucket, scope: UploadScope, planned: VideoUpload, n: number, bytes: Uint8Array, now: Date = new Date(),
): Promise<UploadResult<{ partNumber: number; size: number }>> {
    let row = planned;
    if (n === 1) {
        const opened = await openOnFirstPart(db, bucket, scope, row, bytes);
        if (!opened.ok) return opened;
        row = opened.row;
    }
    if (!row.r2Key || !row.uploadId) return GONE;
    let etag: string;
    try {
        etag = (await r2ResumeMultipart(bucket, row.r2Key, row.uploadId).uploadPart(n, bytes)).etag;
    } catch (err) {
        if (classify(err) !== 'no-such-upload') throw err;
        await leaveOpen(db, scope, 'open', 'failed');
        return GONE;
    }
    await db.insert(videoUploadParts).values({
        tenantId: scope.tenantId, mediaId: scope.mediaId, partNumber: n, etag, sizeBytes: bytes.byteLength, receivedAt: now,
    }).onConflictDoUpdate({
        target: [videoUploadParts.tenantId, videoUploadParts.mediaId, videoUploadParts.partNumber],
        set: { etag, sizeBytes: bytes.byteLength, receivedAt: now },
    });
    return { ok: true, partNumber: n, size: bytes.byteLength };
}

/** Join the parts into one object once the ledger shows every part, at its exact size, and the total is within the limit. */
export async function complete(db: AppDrizzle, bucket: R2Bucket, scope: UploadScope, now: Date = new Date()): Promise<UploadResult<{ mediaId: string; r2Key: string }>> {
    let row = await loadRow(db, scope);
    if (!row) return NOT_FOUND;
    if (row.state === 'completed' && row.r2Key) return { ok: true, mediaId: row.mediaId, r2Key: row.r2Key };
    if (row.state === 'completing') {
        if (!isStuck(row, now)) return BUSY;
        const settled = await settleCompleting(db, bucket, row, now);
        if (settled === 'completed' && row.r2Key) return { ok: true, mediaId: row.mediaId, r2Key: row.r2Key };
        if (settled === 'wrong-size') return SIZE_MISMATCH;
        // No object and nobody finishing it: open it again and run the completion below.
        if (!(await leaveOpen(db, row, 'completing', 'open'))) return BUSY;
        row = { ...row, state: 'open' };
    }
    const refused = notOpen(row);
    if (refused) return refused;

    const parts = await db.select().from(videoUploadParts).where(partsOf(scope)).orderBy(asc(videoUploadParts.partNumber)).all();
    const have = new Set(parts.map((p) => p.partNumber));
    const missing = Array.from({ length: row.partCount }, (_, i) => i + 1).filter((n) => !have.has(n));
    if (missing.length > 0 || !row.r2Key || !row.uploadId) {
        return fail(409, 'VIDEO_PARTS_MISSING', 'Some parts have not arrived.', { missing });
    }
    const total = parts.reduce((sum, p) => sum + p.sizeBytes, 0);
    if (total > MAX_VIDEO_BYTES) return fail(413, 'VIDEO_TOO_LARGE', 'Video is too large.', { limits: { maxBytes: MAX_VIDEO_BYTES } });
    if (total !== row.totalBytes || parts.some((p) => p.sizeBytes !== expectedPartSize(row, p.partNumber))) {
        await db.delete(videoUploadParts).where(partsOf(scope));
        return fail(409, 'VIDEO_PARTS_MISMATCH', 'The received parts do not add up; send them again.');
    }
    // Only one of two concurrent completions gets past here.
    if (!(await leaveOpen(db, scope, 'open', 'completing', { completingAt: now }))) return BUSY;

    let object: R2Object;
    try {
        object = await r2ResumeMultipart(bucket, row.r2Key, row.uploadId).complete(parts.map((p) => ({ partNumber: p.partNumber, etag: p.etag })));
    } catch (err) {
        const kind = classify(err);
        // A part was re-sent while another copy was in flight: the ledger and storage disagree, so start the parts over.
        if (kind === 'invalid-part') {
            await db.delete(videoUploadParts).where(partsOf(scope));
            await leaveOpen(db, scope, 'completing', 'open');
            return fail(409, 'VIDEO_PARTS_MISMATCH', 'The received parts do not add up; send them again.');
        }
        if (kind === 'other') {
            logger.error('video-chunked: completing failed', { tenantId: scope.tenantId, mediaId: scope.mediaId, error: err instanceof Error ? err.message : String(err) });
        }
        // Storage may have joined the object and lost the answer (or a retry finds the upload already gone): look at the object.
        const settled = await settleCompleting(db, bucket, row, now);
        if (settled === 'completed') return { ok: true, mediaId: row.mediaId, r2Key: row.r2Key };
        if (settled === 'wrong-size') return SIZE_MISMATCH;
        if (kind === 'no-such-upload') {
            await leaveOpen(db, scope, 'completing', 'failed');
            return GONE;
        }
        await leaveOpen(db, scope, 'completing', 'open');
        throw err;
    }
    if (object.size !== row.totalBytes) {
        await r2Delete(bucket, row.r2Key);
        await leaveOpen(db, scope, 'completing', 'failed');
        return SIZE_MISMATCH;
    }
    await leaveOpen(db, scope, 'completing', 'completed', { completedAt: now });
    await db.delete(videoUploadParts).where(partsOf(scope));
    return { ok: true, mediaId: row.mediaId, r2Key: row.r2Key };
}

/** Cancel an unfinished upload. Repeating it is fine; a finished upload cannot be cancelled with its token. */
export async function abort(db: AppDrizzle, bucket: R2Bucket, scope: UploadScope, now: Date = new Date()): Promise<UploadResult<unknown>> {
    const row = await loadRow(db, scope);
    // The token is keyed by the caller's own company and media id, so "nothing to cancel" reveals nothing.
    if (!row || row.state === 'aborted' || row.state === 'failed') return { ok: true };
    let from: 'open' | 'completing' = 'open';
    if (row.state === 'completing') {
        if (!isStuck(row, now)) return BUSY;
        const settled = await settleCompleting(db, bucket, row, now);
        if (settled === 'completed') return DONE;
        if (settled === 'wrong-size') return { ok: true };
        from = 'completing';
    } else {
        const refused = notOpen(row);
        if (refused) return refused;
    }
    if (await leaveOpen(db, scope, from, 'aborted')) {
        await abortStorage(bucket, row);
        await db.delete(videoUploadParts).where(partsOf(scope));
    }
    return { ok: true };
}
