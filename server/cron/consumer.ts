/**
 * Cron queue consumer.
 *
 * Each message is its own Worker invocation with its own CPU budget, which is
 * the entire reason this queue exists: the Workers Free ceiling is 10 ms PER
 * INVOCATION, so thirteen jobs in one scheduled() call cannot fit no matter how
 * fast each one is, and thirteen separate invocations can.
 *
 * A job that has more work than one batch re-enqueues itself with a cursor
 * rather than looping — a loop would put the whole sweep back inside one
 * invocation and undo the split.
 */
import { CRON_JOBS, type CronJob } from './registry';
import { writeCursor } from './cursor';
import { logger } from '../lib/logger';

export interface CronMessage {
    job: string;
    cursor: string | null;
    hop: number;
}

/**
 * Ceiling on self-continuation hops for one dispatch. It bounds the damage from
 * a paging bug that never returns a null cursor — which would otherwise spend
 * the day's entire Queues allowance in an hour. A sweep that hits the ceiling
 * is not lost: its cursor is persisted, so the next tick resumes where it
 * stopped.
 */
export const MAX_HOPS = 100;

type RunnableJob = Pick<CronJob, 'key' | 'run'>;

export async function handleCronBatch(
    env: { CRON_QUEUE?: Queue<CronMessage>; TENANT_CACHE?: KVNamespace } & Record<string, unknown>,
    batch: MessageBatch<CronMessage>,
    jobs: readonly RunnableJob[] = CRON_JOBS,
): Promise<void> {
    for (const message of batch.messages) {
        const { job: jobKey, cursor, hop } = message.body;
        const job = jobs.find((j) => j.key === jobKey);
        if (!job) {
            // A renamed or removed job. Retrying cannot help and would spend the
            // free-tier queue budget over and over; drop it loudly instead.
            logger.warn('[cron:queue] unknown job key — dropping', { job: jobKey, hop });
            message.ack();
            continue;
        }
        try {
            const { processed, nextCursor } = await job.run(env as never, cursor);
            // Persist BEFORE re-enqueueing. The in-message cursor carries a
            // sweep across hops; the stored one carries it across ticks, and a
            // sweep stopped by the hop ceiling has only the stored one left.
            // Writing null on completion matters just as much: a stale cursor
            // that is never cleared means the sweep never sees its first page
            // again.
            await writeCursor(env, jobKey, nextCursor);
            if (nextCursor !== null && hop < MAX_HOPS) {
                await env.CRON_QUEUE?.send({ job: jobKey, cursor: nextCursor, hop: hop + 1 });
            } else if (nextCursor !== null) {
                logger.warn('[cron:queue] hop ceiling reached — sweep will resume next tick', { job: jobKey, hop, processed });
            }
            message.ack();
        } catch (e) {
            logger.error('[cron:queue] job threw', { job: jobKey, hop }, e instanceof Error ? e : undefined);
            message.retry();
        }
    }
}
