import { defineConfig } from 'vitest/config';
import { cloudflareTest } from '@cloudflare/vitest-pool-workers';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';

// An ES256 keypair minted when this config loads, never stored. `contextBootstrap`
// builds a keyring from these on EVERY request and throws when they are absent,
// which fails the request before any middleware D1 work happens — so a suite that
// measures the middleware chain cannot run without them. Generating rather than
// committing a PEM keeps key material out of a public repository and out of every
// secret scanner's inbox; nothing here verifies a token minted anywhere else.
const testKeyPair = generateKeyPairSync('ec', {
    namedCurve: 'P-256',
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

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
    resolve: {
        // `server/lib/i18n/messages.ts` re-exports the compiled Paraglide
        // catalogue, which lives under `app/`. This is the FOURTH resolver that
        // has to agree on that — tsconfig.api.json's paths, vitest.api.config.ts,
        // vite.config.ts and here — and it is the one that only fails inside
        // real workerd, long after the other three are green.
        alias: { '~': path.resolve(__dirname, 'app') },
    },
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
                // TENANT_CACHE + the JWT keyring are what the global `app.use('*')`
                // chain reads on every request. Without them the chain throws
                // before it does any of the work `middleware-d1-floor.spec.ts`
                // exists to count.
                kvNamespaces: { TENANT_CACHE: 'test-tenant-cache' },
                bindings: {
                    JWT_CURRENT_KID: 'v1',
                    JWT_PRIVATE_KEY_V1: testKeyPair.privateKey,
                    JWT_PUBLIC_KEY_V1: testKeyPair.publicKey,
                    JWT_SECRET: 'test-only-kdf-input',
                },
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
                    // Per-tenant presence — the second of the two objects that
                    // hold storage, and so the second the tenant purge must be
                    // able to empty (do-purge.spec.ts).
                    TENANT_PRESENCE: 'TenantPresenceDO',
                },
            },
        }),
    ],
    test: {
        include: ['tests/workers/**/*.spec.ts'],
    },
});
