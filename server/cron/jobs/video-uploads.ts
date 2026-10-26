/**
 * The chunked video upload sweep: aborts the storage uploads of abandoned upload rows and deletes
 * the ended ones. The work and its rules are in `services/video/chunked-upload-sweep.ts`.
 */
import { drizzle } from 'drizzle-orm/d1';
import { TICK, type CronJob } from '../types';

/**
 * Rows reaped per invocation. UNMEASURED: a row costs up to one storage call and three D1 statements,
 * so ten is about thirty subrequests; the free-plan CPU cost has not been read back from a deployment.
 */
const VIDEO_UPLOAD_SWEEP_BATCH = 10;

export const videoUploadSweepJob: CronJob = {
    key: 'video-upload-sweep',
    label: 'Abort abandoned chunked video uploads',
    trigger: TICK,
    modes: ['standalone', 'saas'],
    maxBatch: VIDEO_UPLOAD_SWEEP_BATCH,
    // One indexed LIMIT-1 read over (state, expires_at); an idle tick costs almost nothing.
    probe: async (env) => {
        if (!env.PHOTOS) return 0;
        const { hasDueVideoUploads } = await import('../../services/video/chunked-upload-sweep');
        return (await hasDueVideoUploads(drizzle(env.DB), new Date())) ? 1 : 0;
    },
    run: async (env) => {
        if (!env.PHOTOS) return { processed: 0, nextCursor: null };
        const { sweepVideoUploads } = await import('../../services/video/chunked-upload-sweep');
        // Rows still due after this pass are found by the next tick's probe; no cursor is needed.
        return { processed: await sweepVideoUploads(drizzle(env.DB), env.PHOTOS, new Date(), VIDEO_UPLOAD_SWEEP_BATCH), nextCursor: null };
    },
};
