// Test-only worker entry for the vitest-pool-workers (workerd) suite.
//
// vitest-pool-workers runs this module in the SAME isolate as the test files,
// and uses it as the consumer for any miniflare queueConsumers we configure.
// We point the SYNC_QUEUE producer at a real consumer here so the producer
// tests can assert "the envelope actually landed on the queue" by recording
// every delivered message body into a D1 table the test then reads back.
//
// This is NOT production code — it exists only to give the queue a real sink
// inside the test runtime. Production delivery goes to the portal worker.

// Re-export the DO so vitest-pool-workers can bind it as INSPECTION_DOC.
// runInDurableObject() only works with DOs defined in the `main` worker.
export { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
export { InspectionPresenceDO } from '../../server/durable-objects/inspection-presence';

interface TestEnv {
    DB: D1Database;
    /** Written only by the env-identity probe below. Never set by any config. */
    __probeMarker?: string;
}

export default {
    /**
     * Probe: is `env` the SAME OBJECT on every invocation inside one isolate?
     *
     * Production code answers this question implicitly — `integrationSecretsMiddleware`
     * merges a tenant's decrypted secrets into `c.env` IN PLACE. If the runtime
     * hands every request the same object, that write outlives the request and
     * the next tenant inherits it. Nothing in the node-env suites can see this;
     * only real workerd can.
     *
     * Test-only. Reports what it found BEFORE writing, so two sequential calls
     * distinguish a fresh env from a shared one.
     */
    async fetch(request: Request, env: TestEnv): Promise<Response> {
        const url = new URL(request.url);
        if (url.pathname === '/__probe/env-identity') {
            const sawBefore = env.__probeMarker ?? null;
            env.__probeMarker = 'written-by-a-previous-request';
            return Response.json({ sawBefore });
        }
        return new Response('not found', { status: 404 });
    },

    // The consumer for `inspectorhub-sync-saas` inside the test runtime. Records
    // each delivered envelope's id into `test_queue_log` so producer tests can
    // assert delivery against the real SYNC_QUEUE binding (not a mock).
    async queue(batch: MessageBatch<unknown>, env: TestEnv): Promise<void> {
        for (const msg of batch.messages) {
            const body = msg.body as { id?: string; type?: string } | undefined;
            await env.DB.prepare(
                'INSERT OR IGNORE INTO test_queue_log (id, type, body, received_at) VALUES (?, ?, ?, ?)',
            )
                .bind(
                    typeof body?.id === 'string' ? body.id : crypto.randomUUID(),
                    typeof body?.type === 'string' ? body.type : null,
                    JSON.stringify(body ?? null),
                    Math.floor(Date.now() / 1000),
                )
                .run();
            msg.ack();
        }
    },
} satisfies ExportedHandler<TestEnv>;
