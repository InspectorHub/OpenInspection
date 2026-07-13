// C-8 — core producer path under real workerd (vitest-pool-workers / miniflare).
//
// Exercises the PRODUCTION outbox functions against the real SYNC_QUEUE + D1
// bindings (not mocks): publishRow delivery, the cron sweeper, and the DLQ
// writeback handler. The queue has a real consumer (tests/workers/test-worker.ts)
// that records delivered envelopes into `test_queue_log`, so we can assert the
// envelope actually traversed the queue.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { publishRow, flushOutboxOnce, type OutboxRow } from '../../server/portal/outbox.service';
import { handleSyncDlqBatch } from '../../server/portal/integration.module';

// `env` from cloudflare:test carries our inline miniflare bindings.
interface TestBindings {
    DB: D1Database;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SYNC_QUEUE: Queue<any>;
}
const b = env as unknown as TestBindings;

const NOW = () => Date.now();

async function seedSchema(): Promise<void> {
    // Minimal-but-faithful DDL for sync_outbox (per schema/tenant.ts) plus the
    // test-only delivery log the test worker writes to.
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT \'pending\', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);',
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS test_queue_log (id TEXT PRIMARY KEY, type TEXT, body TEXT, received_at INTEGER);',
    );
}

async function clearTables(): Promise<void> {
    await b.DB.exec('DELETE FROM sync_outbox;');
    await b.DB.exec('DELETE FROM test_queue_log;');
}

async function insertRow(
    over: Partial<Omit<OutboxRow, 'createdAt'>> & { createdAt?: number } = {},
): Promise<string> {
    const id = over.id ?? crypto.randomUUID();
    await b.DB.prepare(
        'INSERT INTO sync_outbox (id, event_type, payload, status, attempts, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
        .bind(
            id,
            over.eventType ?? 'user.invited',
            over.payload ??
                JSON.stringify({ tenantId: 't1', email: 'a@example.com', role: 'member', passwordHash: 'h' }),
            over.status ?? 'pending',
            over.attempts ?? 0,
            over.createdAt ?? NOW(),
        )
        .run();
    return id;
}

async function getStatus(id: string): Promise<string | undefined> {
    const row = await b.DB.prepare('SELECT status FROM sync_outbox WHERE id = ?').bind(id).first<{ status: string }>();
    return row?.status;
}

/** Poll the delivery log until the message id appears (queue delivery is async). */
async function waitForDelivery(id: string, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const row = await b.DB.prepare('SELECT id FROM test_queue_log WHERE id = ?').bind(id).first();
        if (row) return true;
        await new Promise((r) => setTimeout(r, 25));
    }
    return false;
}

describe('core producer — real queue + D1 (C-8)', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('publishRow delivers the envelope to SYNC_QUEUE and flips the row to published', async () => {
        const id = await insertRow();
        const row = (await b.DB.prepare('SELECT * FROM sync_outbox WHERE id = ?').bind(id).first()) as unknown;

        await publishRow(b.DB, b.SYNC_QUEUE, {
            id,
            eventType: (row as { event_type: string }).event_type,
            payload: (row as { payload: string }).payload,
            status: 'pending',
            attempts: 0,
            createdAt: new Date((row as { created_at: number }).created_at),
            lastTriedAt: null,
            lastError: null,
        });

        // Row flipped immediately (publishRow awaits the D1 update).
        expect(await getStatus(id)).toBe('published');

        // The envelope actually traversed the real queue to the test consumer.
        expect(await waitForDelivery(id)).toBe(true);
        const logged = await b.DB.prepare('SELECT type, body FROM test_queue_log WHERE id = ?')
            .bind(id)
            .first<{ type: string; body: string }>();
        expect(logged?.type).toBe('io.inspectorhub.user.invited');
        const envelope = JSON.parse(logged!.body) as { specversion: string; dataschema: string; data: Record<string, unknown> };
        expect(envelope.specversion).toBe('1.0');
        expect(envelope.dataschema).toBe('user-invited/v1');
        expect(envelope.data['email']).toBe('a@example.com');
    });

    it('sweeper republishes a stale pending row and skips a fresh one', async () => {
        const fresh = await insertRow(); // created_at = now → inside the 120s window
        const stale = await insertRow({ createdAt: NOW() - 300_000 });

        const res = await flushOutboxOnce(b.DB, b.SYNC_QUEUE, 50);

        expect(res.published).toBe(1);
        expect(await getStatus(stale)).toBe('published');
        expect(await getStatus(fresh)).toBe('pending');
        expect(await waitForDelivery(stale)).toBe(true);
    });

    it('DLQ writeback marks the originating row failed and always acks', async () => {
        const id = await insertRow({ status: 'published' });
        const acks: string[] = [];
        const batch = {
            queue: 'inspectorhub-sync-dlq-saas',
            messages: [
                {
                    id: 'm1',
                    timestamp: new Date(),
                    body: { id },
                    attempts: 5,
                    ack: () => acks.push('m1'),
                    retry: () => { throw new Error('should not retry on DLQ'); },
                },
                {
                    id: 'm2',
                    timestamp: new Date(),
                    body: 'not-an-envelope',
                    attempts: 5,
                    ack: () => acks.push('m2'),
                    retry: () => { throw new Error('should not retry on DLQ'); },
                },
            ],
            ackAll: () => {},
            retryAll: () => {},
        };

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await handleSyncDlqBatch(b.DB, batch as any);

        expect(await getStatus(id)).toBe('failed');
        const row = await b.DB.prepare('SELECT last_error FROM sync_outbox WHERE id = ?')
            .bind(id)
            .first<{ last_error: string }>();
        expect(row?.last_error).toContain('dlq');
        expect(acks).toEqual(['m1', 'm2']); // malformed body still acked
    });
});
