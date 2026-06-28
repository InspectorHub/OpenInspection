// Single composition seam for the SaaS-Portal integration. The rest of the
// codebase touches portal ONLY via this module's two exports + the
// IntegrationProvider / OutboxService selection in lib/middleware/di.ts.
// Standalone never reaches these in normal operation. The worker entry
// (workers/app.ts) 404s /api/integration/* unless APP_MODE=saas.
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
import type { SyncEnvelope } from '../lib/sync-events/envelope';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import integrationRoutes from './integration.routes';
import { flushOutboxOnce, OutboxService } from './outbox.service';
import { logger } from '../lib/logger';

/** Minimal env shape the outbox sweeper needs — satisfied by both AppEnv and
 *  ScheduledEnv. `SYNC_QUEUE` is the producer binding to the sync queue (saas
 *  only); absent in standalone, where the sweeper is a no-op. */
interface PortalDrainEnv {
    DB: D1Database;
    SYNC_QUEUE?: Queue<SyncEnvelope>;
}

/** Mount the portal->core M2M integration routes on the API app. */
export function registerPortalIntegration(app: OpenAPIHono<HonoConfig>): void {
    app.route('/api/integration', integrationRoutes);
}

/**
 * Build a concrete UserSyncOutbox (OutboxService) when SYNC_QUEUE is present,
 * or return undefined in standalone mode.
 *
 * Callers outside server/portal/ MUST reach the concrete OutboxService only
 * through this builder (or through di.ts) — never by importing OutboxService
 * directly. The builder is loaded via dynamic import inside an
 * `if (env.SYNC_QUEUE)` guard so standalone never pulls portal code.
 *
 * The returned instance uses no inline-publish hook (no executionCtx available
 * in cron/webhook non-request contexts); the cron outbox sweeper handles
 * republication. For request-scoped construction with inline publish see di.ts.
 */
export function buildUserSyncOutbox(
    env: { DB: D1Database; SYNC_QUEUE?: Queue },
): UserSyncOutbox | undefined {
    if (!env.SYNC_QUEUE) return undefined;
    return new OutboxService(env.DB);
}

/** Sweeper pass: republish any `pending` outbox rows (older than the inline
 *  publish window) to the sync queue. Gated on env.SYNC_QUEUE — when the queue
 *  binding is absent this is a no-op (logged once). The queue is the sole
 *  transport; the legacy Service-Binding POST drain has been removed. */
export async function drainPortalOutbox(env: PortalDrainEnv): Promise<void> {
    if (!env.SYNC_QUEUE) {
        logger.info('[cron:outbox] SYNC_QUEUE not bound — sweeper skipped');
        return;
    }
    await flushOutboxOnce(env.DB, env.SYNC_QUEUE, 50);
}

/**
 * DLQ writeback core. Processes one batch of dead messages from
 * `inspectorhub-sync-dlq-saas`: each message body is a SyncEnvelope that
 * exhausted the portal consumer's retries. For each, mark the originating
 * outbox row `failed` (the durable failure record surfaced by the console),
 * then ack the message. Tolerant: a malformed body is logged and acked (never
 * recycled — there is nothing to retry on a dead message). Never throws the
 * batch. Exported standalone so unit tests can drive it without a worker.
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
