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
                compatibilityDate: '2024-11-01',
                compatibilityFlags: ['nodejs_compat'],
                d1Databases: { DB: 'test-sync-db' },
                queueProducers: {
                    SYNC_QUEUE: { queueName: 'inspectorhub-sync-saas' },
                },
                queueConsumers: {
                    'inspectorhub-sync-saas': {
                        maxBatchSize: 10,
                        maxBatchTimeout: 0,
                    },
                },
            },
        }),
    ],
    test: {
        include: ['tests/workers/**/*.spec.ts'],
    },
});
