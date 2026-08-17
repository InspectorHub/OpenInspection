/**
 * The cmd queue's batch loop — delivery plumbing, not command semantics.
 *
 * Split out of `cmd-consumer.ts` when that file crossed the 400-line gate. The
 * seam is real rather than arithmetic: everything here is about how a message
 * is acked, retried and backed off, and knows nothing about what any command
 * means; everything left behind is about what a command does and knows nothing
 * about queues. The two changed for unrelated reasons every time either did.
 */
import { logger } from '../lib/logger';
import type { SyncEnvelope } from '../lib/sync-events/envelope';
import {
    applyCmdEnvelope,
    type CmdConsumerBuckets,
    type PurgeDurableObjects,
} from './cmd-consumer';
import type { EmailServiceEnv } from '../lib/email/build-email-service';

/** Mirror of portal's queue-loop backoff. */
function backoffSeconds(attempts: number): number {
    return Math.min(30 * 2 ** attempts, 3600);
}

/** Batch handler for the cmd queue. STRICTLY per-message ack/retry.
 *  `syncQueue` (A-21 batch 2) carries replies back to portal; `buckets`
 *  (batch 3) carries the R2 bindings the offboarding commands need; `dos`
 *  carries the Durable Object namespaces the purge destroys — all optional so
 *  the standalone build type-checks unchanged. */
export async function handleCmdBatch(
    dbBinding: D1Database,
    kv: KVNamespace | undefined,
    batch: MessageBatch<unknown>,
    syncQueue?: Queue<SyncEnvelope>,
    buckets?: CmdConsumerBuckets,
    dos?: PurgeDurableObjects,
    emailEnv?: EmailServiceEnv,
): Promise<void> {
    for (const msg of batch.messages) {
        try {
            const result = await applyCmdEnvelope(dbBinding, kv, msg.body, syncQueue, buckets, dos, emailEnv);
            logger.info('[cmd] queue message handled', { id: msg.id, attempts: msg.attempts, result });
            msg.ack();
        } catch (err) {
            const delaySeconds = backoffSeconds(msg.attempts);
            logger.error('[cmd] queue message failed — retrying',
                { id: msg.id, attempts: msg.attempts, delaySeconds },
                err instanceof Error ? err : undefined);
            msg.retry({ delaySeconds });
        }
    }
}
