// A-21 batch 3 — offboarding commands through the consumer pipeline: the
// export/purge SERVICES are stubbed (the streaming exporter has its own real
// R2 coverage in data-export-stream.spec.ts; the purge service pre-dates this
// seam) — what's under test here is the dispatch + reply contract.
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import exportCmd from '../fixtures/cmd-events/cmd-tenant-data-export-v1.json';
import purgeCmd from '../fixtures/cmd-events/cmd-tenant-purge-v1.json';

vi.mock('../../server/services/data-export.service', () => ({
    DataExportService: class {
        async buildZipToR2(_tenantId: string, _bucket: unknown, _key: string) {
            return { rows: 2, photos: 3, photosEmbedded: 3 };
        }
    },
}));
vi.mock('../../server/services/tenant-purge.service', () => ({
    TenantPurgeService: class {
        async purge(_tenantId: string) {
            return { rows: 42, r2: 3, r2Bytes: 1048576, kv: 2 };
        }
    },
}));

const b = env as unknown as { DB: D1Database; PHOTOS: R2Bucket; EXPORTS_BUCKET: R2Bucket };
const kvStub = { delete: async () => {} } as unknown as KVNamespace;

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, name TEXT NOT NULL, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', stripe_connect_account_id TEXT, status TEXT NOT NULL DEFAULT 'pending', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', nachi_number TEXT, applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
    );
    await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
    await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
    );
    await b.DB.exec(
        'CREATE TABLE IF NOT EXISTS usage_counters (tenant_id TEXT NOT NULL, metric TEXT NOT NULL, period_key TEXT NOT NULL, value INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (tenant_id, metric, period_key));',
    );
}

async function clearTables(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'sync_outbox', 'tenants']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
    await b.DB.prepare("INSERT INTO tenants (id, name, slug, created_at) VALUES ('fixture-tenant-3', 'F3', 'ws-f3', 1)").run();
}

function fakeQueue() {
    const sent: Array<Record<string, unknown>> = [];
    return {
        sent,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        queue: { send: async (e: unknown) => { sent.push(e as Record<string, unknown>); } } as any,
    };
}

const buckets = () => ({ photos: b.PHOTOS, exports: b.EXPORTS_BUCKET });

describe('cmd consumer — offboarding commands (A-21 batch 3)', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('data_export applies and replies export_completed with r2Key + manifest (matches the golden fixture)', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, exportCmd, q.queue, buckets())).toBe('applied');
        expect(q.sent).toHaveLength(1);
        expect(q.sent[0]).toMatchObject({
            type: 'io.inspectorhub.reply.tenant.export_completed',
            source: 'core',
            dataschema: 'reply-tenant-export-completed/v1',
            data: {
                tenantId: 'fixture-tenant-3',
                correlationId: exportCmd.id,
                replyto: exportCmd.replyto,
                r2Key: 'exports/fixture-tenant-3/1780000000000.zip',
                manifest: { rows: 2, photos: 3, photosEmbedded: 3 },
            },
        });
        const t = await b.DB.prepare('SELECT applied_cmd_seq FROM tenants WHERE id = ?').bind('fixture-tenant-3').first<{ applied_cmd_seq: number }>();
        expect(t?.applied_cmd_seq).toBe(1);
    });

    it('purge applies and replies purged with destruction counts (matches the golden fixture)', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, purgeCmd, q.queue, buckets())).toBe('applied');
        expect(q.sent[0]).toMatchObject({
            type: 'io.inspectorhub.reply.tenant.purged',
            dataschema: 'reply-tenant-purged/v1',
            data: {
                tenantId: 'fixture-tenant-3',
                correlationId: purgeCmd.id,
                replyto: purgeCmd.replyto,
                rows: 42, r2: 3, r2Bytes: 1048576, kv: 2,
            },
        });
    });

    it('data_export without the R2 bindings throws (retryable → surfaces as a failed cmd row, never silent)', async () => {
        await expect(applyCmdEnvelope(b.DB, kvStub, exportCmd, undefined, undefined))
            .rejects.toThrow(/EXPORTS_BUCKET not bound|PHOTOS/);
        // Dedup marker rolled back — a retry with bindings re-applies.
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, exportCmd, q.queue, buckets())).toBe('applied');
    });

    it('duplicate export does NOT re-emit (offboarding lost replies recover via the workflow timeout, not duplicates)', async () => {
        const q = fakeQueue();
        expect(await applyCmdEnvelope(b.DB, kvStub, exportCmd, q.queue, buckets())).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, kvStub, exportCmd, q.queue, buckets())).toBe('duplicate');
        expect(q.sent).toHaveLength(1);
        const n = await b.DB.prepare('SELECT count(*) AS n FROM sync_outbox').first<{ n: number }>();
        expect(n?.n).toBe(1);
    });
});
