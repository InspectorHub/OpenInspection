/**
 * Reaping chunked video uploads that were never finished.
 *
 * A token's upload cannot continue once the token has expired, so a row past its own `expires_at`
 * is an upload nobody can finish. Unfinished parts in the object store are billed until the upload
 * is aborted, so this is the only thing that stops an abandoned upload from costing storage for ever
 * (the store's own seven-day auto-abort is the backstop, not the plan).
 *
 *   open, expired        abort the storage upload, mark the row aborted, drop its parts
 *   completing, expired  look at the object first (`settleCompleting`): if it exists the upload had
 *                        finished and the row is settled as completed; only when it does not exist is
 *                        the storage upload aborted. The object key is NEVER deleted here.
 *   ended, past grace    (completed, aborted or failed, a day after `expires_at`) abort whatever
 *                        storage upload is left over, drop any parts, delete the row. The grace is what
 *                        keeps a replayed token refused for as long as the token could be replayed.
 *
 * Each pass handles at most `limit` rows, oldest first, and one row's failure never stops the others.
 * A row is only ever acted on through its own (tenant, media) pair, so a pass reaches every company
 * without reading across one.
 */
import { and, asc, eq, inArray, lt, or } from 'drizzle-orm';
import type { AppDrizzle } from '../../lib/route-helpers';
import { videoUploads, videoUploadParts, type VideoUpload } from '../../lib/db/schema';
import { logger } from '../../lib/logger';
import { abortStorage, leaveOpen, partsOf, settleCompleting } from './chunked-upload.service';

/** How long an ended row is kept past `expires_at`. */
export const ENDED_ROW_GRACE_MS = 24 * 60 * 60 * 1000;

const dueRows = (now: Date) => or(
    and(inArray(videoUploads.state, ['open', 'completing']), lt(videoUploads.expiresAt, now)),
    and(inArray(videoUploads.state, ['completed', 'aborted', 'failed']), lt(videoUploads.expiresAt, new Date(now.getTime() - ENDED_ROW_GRACE_MS))),
);

/** The cheap question the cron probe asks: is any row due? One indexed LIMIT-1 read, no row body used. */
export async function hasDueVideoUploads(db: AppDrizzle, now: Date): Promise<boolean> {
    return (await db.select({ id: videoUploads.id }).from(videoUploads).where(dueRows(now)).limit(1).get()) !== undefined;
}

async function reapOne(db: AppDrizzle, bucket: R2Bucket, row: VideoUpload, now: Date): Promise<void> {
    if (row.state === 'completing') {
        const settled = await settleCompleting(db, bucket, row, now);
        if (settled !== 'absent') return;
        await leaveOpen(db, row, 'completing', 'aborted');
        await abortStorage(bucket, row);
        await db.delete(videoUploadParts).where(partsOf(row));
        return;
    }
    if (row.state === 'open') {
        if (await leaveOpen(db, row, 'open', 'aborted')) await abortStorage(bucket, row);
        await db.delete(videoUploadParts).where(partsOf(row));
        return;
    }
    // Ended and past its grace: nothing may still be waiting in storage, then the row itself goes.
    if (row.state !== 'completed') await abortStorage(bucket, row);
    await db.delete(videoUploadParts).where(partsOf(row));
    await db.delete(videoUploads).where(and(eq(videoUploads.tenantId, row.tenantId), eq(videoUploads.mediaId, row.mediaId), eq(videoUploads.id, row.id)));
}

/** One bounded pass; returns how many rows were handled. */
export async function sweepVideoUploads(db: AppDrizzle, bucket: R2Bucket, now: Date, limit: number): Promise<number> {
    const rows = await db.select().from(videoUploads).where(dueRows(now)).orderBy(asc(videoUploads.expiresAt)).limit(limit).all();
    let handled = 0;
    for (const row of rows) {
        try {
            await reapOne(db, bucket, row, now);
            handled += 1;
        } catch (err) {
            logger.error('video-upload-sweep: a row could not be reaped', {
                tenantId: row.tenantId, mediaId: row.mediaId, state: row.state, error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    return handled;
}
