/**
 * The cron tick, after the free-tier refactor.
 *
 * It probes and enqueues. It never runs a job body — that is the invariant the
 * 10 ms Free per-invocation CPU ceiling requires, and `cron-dispatch.spec.ts`
 * asserts it.
 *
 * Probe-then-enqueue rather than enqueue-always because of the OTHER free-tier
 * ceiling: Queues allows 10,000 operations/day, shared with the word-export
 * queue. Enqueueing thirteen jobs unconditionally costs 288 ticks x 13 x 2 =
 * 7,488 ops/day before any real work happens. A single-inspector deployment's
 * ticks are almost all empty, so probing first costs a few cheap indexed reads
 * and sends nothing.
 */
import { CRON_JOBS, TICK, type CronJob } from './registry';
import { readCursor } from './cursor';
import { getDeploymentProfile } from '../lib/deployment-profile';
import { logger } from '../lib/logger';
import type { ScheduledEnv } from '../scheduled';

export async function dispatchCron(
    event: { cron: string },
    env: ScheduledEnv,
    jobs: readonly CronJob[] = CRON_JOBS,
): Promise<void> {
    const mode = getDeploymentProfile(env).mode;
    const cron = event.cron || TICK;
    const firing = jobs.filter((j) => j.trigger === cron && j.modes.includes(mode));

    let probed = 0;
    let enqueued = 0;
    let failed = 0;
    for (const job of firing) {
        try {
            probed++;
            const due = await job.probe(env);
            if (due <= 0) continue;
            const cursor = await readCursor(env, job.key);
            await env.CRON_QUEUE?.send({ job: job.key, cursor, hop: 0 });
            enqueued++;
        } catch (e) {
            // One job's probe must not cost the others their tick — the failure
            // this whole refactor exists to remove is silent starvation of the
            // jobs that happen to sit later in the list.
            failed++;
            logger.error('[cron] probe failed', { job: job.key }, e instanceof Error ? e : undefined);
        }
    }

    // Every number, every tick, whether or not anything happened. A dispatcher
    // that reported only what it enqueued would read identically on the day it
    // probed nothing at all — and "the cron stopped probing" is exactly the
    // failure that went unnoticed for the life of the old handler.
    logger.info('[cron] dispatch', {
        cron, mode, registered: jobs.length, matched: firing.length, probed, enqueued, failed,
    });

    if (!env.CRON_QUEUE) {
        logger.error('[cron] CRON_QUEUE is not bound — no job will run', { cron, probed });
    }
}
