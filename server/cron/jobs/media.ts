/**
 * The two object-store sweeps.
 *
 * Both are a large part of why this refactor exists: each used to walk
 * everything it could see on every five-minute tick, so its cost was the size
 * of the data rather than the size of the work, and it grew silently after
 * shipping.
 *
 * Both are also the only two jobs whose "is there work?" question has no cheap
 * answer in the database - the predicate lives in an object key, not in a row -
 * so their probes are a clock plus "a paged sweep is already in flight". The
 * interval marker is written only after a COMPLETE pass, so an interrupted one
 * stays due instead of being recorded as done.
 */
import { logger } from '../../lib/logger';
import { isIntervalDue, markRan } from '../cursor';
import { TICK, type CronJob } from '../types';

/** How often each object-store sweep is allowed to start a fresh pass. */
const ORPHAN_SWEEP_INTERVAL_MS = 60 * 60 * 1000;
const PENDING_ATTACHMENT_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Inspections examined per orphan-sweep invocation.
 *
 * UNMEASURED. It is a reasoned starting point, not a tuned value: the cost per
 * inspection is one R2 prefix list plus one to three D1 reads, and - only for
 * inspections that actually hold objects - a report-blob parse, which is the
 * expensive part and the one whose size varies most. Nobody has yet run this
 * against a real deployment and read the CPU back, so treat it as the number to
 * CHECK first, not as a number that has been checked.
 */
const ORPHAN_SWEEP_BATCH = 25;

/** R2 list pages walked per _pending-cleanup invocation. Each page is 1000 keys. */
const PENDING_PAGES_PER_RUN = 5;

// 5. Clean up abandoned _pending message attachments older than 24h
export const pendingAttachmentsJob: CronJob = {
    key: 'pending-attachments',
    label: 'Delete abandoned _pending message attachments',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    // R2 list pages per invocation, not objects. Each page is 1000 keys and
    // the per-key work is one string test. The declared cap and the value
    // actually passed are the same constant, so they cannot drift apart.
    maxBatch: PENDING_PAGES_PER_RUN,
    // No cheap due-query exists: the predicate lives in an object key, not
    // in a table, and `_pending` sits MID-key so no prefix can select it.
    // Due-ness is therefore a clock plus "a sweep is already in flight".
    probe: async (env) => {
        if (!env.PHOTOS) return 0;
        return (await isIntervalDue(env, 'pending-attachments', PENDING_ATTACHMENT_INTERVAL_MS, Date.now())) ? 1 : 0;
    },
    run: async (env, cursor) => {
        if (!env.PHOTOS) return { processed: 0, nextCursor: null };
        const { cleanupPendingAttachments } = await import('../../lib/media/pending-attachments');
        const result = await cleanupPendingAttachments(env.PHOTOS, Date.now(), { pages: PENDING_PAGES_PER_RUN, cursor });
        // Only a COMPLETED walk marks the interval done. A partial one is
        // still due, which is what keeps the sweep resuming instead of
        // being recorded as finished when it stopped halfway.
        if (result.nextCursor === null) {
            await markRan(env, 'pending-attachments', PENDING_ATTACHMENT_INTERVAL_MS, Date.now());
        }
        return { processed: result.deleted, nextCursor: result.nextCursor };
    },
};

// 5b. Background GC of orphaned inspection R2 blobs (Q8). Idempotent; grace-windowed.
export const orphanMediaJob: CronJob = {
    key: 'orphan-media',
    label: 'Reap orphaned inspection R2 blobs',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    // Inspections per invocation. Each one costs an R2 prefix list plus up
    // to three D1 reads, and — for those that own media — a report-blob
    // parse, which was the single most expensive item in the old handler.
    maxBatch: ORPHAN_SWEEP_BATCH,
    // Like the _pending cleanup, this sweep's question ("does R2 hold a key
    // no row references?") cannot be asked of D1 cheaply. Clock-driven,
    // and always due while a paged sweep is in flight.
    probe: async (env) => {
        if (!env.PHOTOS) return 0;
        return (await isIntervalDue(env, 'orphan-media', ORPHAN_SWEEP_INTERVAL_MS, Date.now())) ? 1 : 0;
    },
    run: async (env, cursor) => {
        if (!env.PHOTOS) return { processed: 0, nextCursor: null };
        const { sweepOrphanedMedia } = await import('../../lib/media/sweep-orphans');
        const { reaped, nextCursor } = await sweepOrphanedMedia(env.DB, env.PHOTOS, Date.now(), {
            limit: ORPHAN_SWEEP_BATCH, afterInspectionId: cursor,
        });
        if (reaped > 0) logger.info('[cron] reaped orphaned R2 blobs', { reaped });
        // Only a COMPLETED pass over the table marks the interval done.
        if (nextCursor === null) {
            await markRan(env, 'orphan-media', ORPHAN_SWEEP_INTERVAL_MS, Date.now());
        }
        return { processed: reaped, nextCursor };
    },
};
