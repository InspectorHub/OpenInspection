import { logger } from '../logger';

/**
 * Delete abandoned `_pending` message attachments.
 *
 * Uploads for an unsent message land under `{tenant}/messages/_pending/…` and
 * are moved into place when the message is sent. Anything still there a day
 * later belongs to a message nobody sent.
 *
 * Note what CANNOT be done here: R2 `list()` filters by key PREFIX, and
 * `_pending` sits mid-key after the tenant id, so there is no prefix that
 * selects these objects. The sweep has to walk the listing and test each key —
 * which is why it is bounded by PAGES per invocation and carries R2's own
 * cursor across invocations instead. Walking the whole bucket every five
 * minutes, which is what it used to do, is a cost that grows with the bucket
 * and is paid whether or not a single abandoned upload exists.
 */
export interface PendingCleanupOptions {
    /** R2 list pages to walk in this invocation. Each page is up to 1000 keys. */
    pages: number;
    /** R2 cursor to resume from, or null to start at the beginning of the bucket. */
    cursor: string | null;
}

export interface PendingCleanupResult {
    deleted: number;
    /** R2 cursor to resume from, or null when the whole bucket has been walked. */
    nextCursor: string | null;
}

const PENDING_SEGMENT = '/messages/_pending/';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 1000;

export async function cleanupPendingAttachments(
    photos: R2Bucket,
    nowMs: number,
    opts: PendingCleanupOptions,
): Promise<PendingCleanupResult> {
    const cutoff = nowMs - MAX_AGE_MS;
    let cursor: string | undefined = opts.cursor ?? undefined;
    let deleted = 0;
    for (let page = 0; page < opts.pages; page++) {
        const list: R2Objects = await photos.list({ limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) });
        for (const obj of list.objects) {
            if (obj.key.includes(PENDING_SEGMENT) && obj.uploaded.getTime() < cutoff) {
                await photos.delete(obj.key);
                deleted++;
            }
        }
        cursor = list.truncated ? list.cursor : undefined;
        if (!cursor) break;
    }
    if (deleted > 0) logger.info('[cron] cleaned up _pending message attachments', { deleted });
    return { deleted, nextCursor: cursor ?? null };
}
