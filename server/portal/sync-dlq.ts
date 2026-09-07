import type { SyncEnvelope } from '../lib/sync-events/envelope';
import { OutboxService } from './outbox.service';
import { logger } from '../lib/logger';

/**
 * DLQ writeback core. Processes one batch of dead messages from
 * `inspectorhub-sync-dlq-saas`: each message body is a SyncEnvelope that
 * exhausted the portal consumer's retries. For each, mark the originating
 * outbox row `failed` (the durable failure record surfaced by the console),
 * then ack the message. Tolerant: a malformed body is logged and acked (never
 * recycled — there is nothing to retry on a dead message). Never throws the
 * batch. Exported standalone so unit tests can drive it without a worker.
 *
 * It lives in this module rather than in `integration.module.ts` — which
 * re-exports it, so every existing import site is unchanged — for one reason:
 * that module statically imports `integration.routes` and
 * `statutory-admin.routes`, so reaching this function through it pulled two
 * route modules and their Zod schemas into the queue consumer's import graph.
 * The consumer needs `OutboxService` and a logger. Keeping the DLQ handler in
 * a module with no route imports is what lets `server/queue.ts` stay small.
 */
export async function handleSyncDlqBatch(
    db: D1Database,
    batch: MessageBatch<unknown>,
): Promise<void> {
    const svc = new OutboxService(db);
    for (const msg of batch.messages) {
        try {
            const body = msg.body as Partial<SyncEnvelope> | undefined;
            const id = body && typeof body.id === 'string' ? body.id : undefined;
            if (id) {
                await svc.markFailedFromDlq(id, 'dlq: retries exhausted');
            } else {
                logger.warn('[dlq] message without a parseable envelope id — acking', {
                    messageId: msg.id,
                });
            }
        } catch (err) {
            logger.error('[dlq] writeback failed for message', { messageId: msg.id },
                err instanceof Error ? err : undefined);
        } finally {
            // Always ack: a dead message has nothing left to retry. Re-driving
            // happens via the outbox row (sync-redrive), not the DLQ.
            msg.ack();
        }
    }
}
