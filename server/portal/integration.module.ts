// Single composition seam for the SaaS-Portal integration. The rest of the
// codebase touches portal ONLY via this module's two exports + the
// IntegrationProvider / OutboxService selection in lib/middleware/di.ts.
// Standalone never reaches these in normal operation. The worker entry
// (workers/app.ts) 404s /api/platform/* unless APP_MODE=saas.
import type { OpenAPIHono } from '@hono/zod-openapi';
import type { HonoConfig } from '../types/hono';
import type { SyncEnvelope } from '../lib/sync-events/envelope';
import type { UserSyncOutbox } from '../lib/integration/user-sync';
import integrationRoutes from './integration.routes';
import statutoryAdminRoutes from './statutory-admin.routes';
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
    // `/api/platform`, and deliberately not the singular of the word next
    // door: that form sat one letter away from `/api/integrations/*` — the
    // tenant's own QuickBooks/Stripe settings API — and the two differ in
    // caller, auth mechanism and visibility. `platform` follows the vocabulary
    // this seam already uses in its own claims (`platformActor`).
    app.route('/api/platform', integrationRoutes);
    // Its own module rather than more routes in integration.routes.ts: those are
    // about one tenant's lifecycle, these are about the catalogue and the
    // documents produced from it, and the file next door is at its size cap.
    app.route('/api/platform', statutoryAdminRoutes);
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

// The DLQ writeback core moved to `./sync-dlq`, and is re-exported here so
// every existing import site (server/index.ts and two test files) is unchanged.
// The move is what keeps it reachable without this module's route imports —
// see the note in sync-dlq.ts.
export { handleSyncDlqBatch } from './sync-dlq';
