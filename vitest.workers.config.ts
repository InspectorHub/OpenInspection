import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';

// C-8: selective real-runtime (workerd / miniflare) coverage for the queue
// paths only. Existing node-env suites (vitest.api.config.ts / vitest.config.ts)
// are untouched — this config runs ONLY tests/workers/**.
//
// This package ships the vitest-v4 integration: the `cloudflareTest` Vite plugin
// installs the workerd pool runner (`config.poolRunner = cloudflarePool(...)`),
// so there is no `defineWorkersConfig`/`./config` entry in 0.14.x for v4 —
// options (main + miniflare bindings) are passed to the plugin directly.
//
// We do NOT point at wrangler.saas.jsonc (gitignored). Bindings are declared
// inline in `miniflare`:
//   - DB         : isolated-per-test D1 database (schema seeded in beforeAll).
//   - SYNC_QUEUE : the queue producer the core publish/sweeper code sends to.
//   - inspectorhub-sync-saas : consumed by the test worker
//     (tests/workers/test-worker.ts) which records delivered envelopes into D1
//     so producer tests can assert the message actually traversed the queue.
//   `max_batch_timeout: 0` delivers immediately so the producer poll resolves.
export default defineConfig({
    plugins: [
        cloudflareTest({
            main: path.resolve(__dirname, 'tests/workers/test-worker.ts'),
            miniflare: {
                // Bumped from 2024-11-01 → 2026-04-12 (local workerd binary cap)
                // so twilio-node's module-load `require('os')` resolves under
                // nodejs_compat (node:os is compat-date-gated, not force-injected
                // by the pool). Prod runs 2026-05-22 on CF's newer binary; keep
                // this at the local cap.
                compatibilityDate: '2026-04-12',
                compatibilityFlags: ['nodejs_compat'],
                d1Databases: { DB: 'test-sync-db' },
                // A-21 batch 3 — the offboarding commands stream between real
                // (miniflare-emulated) R2 buckets: PHOTOS in, EXPORTS_BUCKET out.
                r2Buckets: { PHOTOS: 'test-photos', EXPORTS_BUCKET: 'test-exports' },
                queueProducers: {
                    SYNC_QUEUE: { queueName: 'inspectorhub-sync-saas' },
                },
                queueConsumers: {
                    'inspectorhub-sync-saas': {
                        maxBatchSize: 10,
                        maxBatchTimeout: 0,
                    },
                },
                // #181 collab editing — bind the production InspectionDocDO so
                // collab-multiclient.spec.ts can drive it with runInDurableObject.
                // The class is re-exported from test-worker.ts (required: main worker).
                durableObjects: {
                    INSPECTION_DOC: 'InspectionDocDO',
                    // Presence DO (WebSocket roster broadcast) — presence-do.spec.ts.
                    INSPECTION_PRESENCE: 'InspectionPresenceDO',
                },
            },
        }),
    ],
    test: {
        include: ['tests/workers/**/*.spec.ts'],
    },
});
