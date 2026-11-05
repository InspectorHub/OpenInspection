/**
 * `cmd.migration.deliver` carrying a reference, through the real consumer in
 * workerd with a real (emulated) R2 bucket and real D1.
 *
 * ── What this proves that the unit spec cannot ─────────────────────────────
 * That a template of the size which motivated the reference route stages into
 * `migration_rows` end to end, that the command which carries it is far inside
 * a queue message while the same bundle inline is not, and that the object is
 * removed afterwards. The bundle is synthetic (`tests/helpers/
 * synthetic-template-bundle.ts`): invented words, no third-party content.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import { deliveryKey, type DeliveryBucket } from '../../server/lib/migration-intake/bundle-delivery';
import { releaseDeliveredBundle } from '../../server/portal/apply-migration-commands';
import type { CmdEnvelope } from '../../server/lib/sync-events/cmd-envelope';
import {
    MIGRATION_BATCHES_TEST_DDL, MIGRATION_ROWS_TEST_DDL, AUDIT_LOGS_TEST_DDL,
} from '../helpers/inline-ddl';
import { buildSyntheticTemplateBundle, serializedBytes } from '../helpers/synthetic-template-bundle';

const b = env as unknown as { DB: D1Database; EXPORTS_BUCKET: R2Bucket };

/**
 * The Cloudflare Queues per-message ceiling, in bytes (1 KB = 1000 bytes; the
 * platform adds roughly 100 bytes of its own metadata).
 * https://developers.cloudflare.com/queues/platform/limits/
 */
const QUEUE_MESSAGE_LIMIT_BYTES = 128_000;

const TENANT = 'tenant-ref-a';
const OTHER_TENANT = 'tenant-ref-b';
const BATCH = 'batch-ref-1';
const OTHER_BATCH = 'batch-ref-2';
const ACTOR = { platformAdminId: 'pa-9', email: 'ops@example.test' };

async function sha256Hex(bytes: BufferSource): Promise<string> {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** Stores the bundle under the key a sender would use, and returns the reference. */
async function stage(bundle: unknown, tenantId = TENANT, batchId = BATCH) {
    const bytes = new TextEncoder().encode(JSON.stringify(bundle));
    const sha256 = await sha256Hex(bytes);
    const key = deliveryKey(tenantId, batchId, sha256);
    await b.EXPORTS_BUCKET.put(key, bytes);
    return { key, bytes: bytes.byteLength, sha256 };
}

function envelope(data: Record<string, unknown>, id = 'cmd-ref-1'): CmdEnvelope {
    return {
        specversion: '1.0',
        id,
        type: 'io.inspectorhub.cmd.migration.deliver',
        source: 'portal',
        time: '2026-11-05T10:00:00.000Z',
        dataschema: 'cmd-migration-deliver/v1',
        tenantseq: 1,
        replyto: `import:${BATCH}`,
        data: { tenantId: TENANT, batchId: BATCH, actor: ACTOR, ...data },
    };
}

/** Wraps the real bucket, counting reads and optionally failing deletes. */
function spyBucket(opts: { failDelete?: boolean } = {}) {
    const calls = { get: 0, delete: 0 };
    const bucket: DeliveryBucket = {
        get: async (key) => { calls.get += 1; return b.EXPORTS_BUCKET.get(key); },
        delete: async (key) => {
            calls.delete += 1;
            if (opts.failDelete) throw new Error('simulated delete failure');
            await b.EXPORTS_BUCKET.delete(key);
        },
    };
    return { bucket, calls };
}

async function seedSchema(): Promise<void> {
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS tenants (id TEXT PRIMARY KEY, slug TEXT UNIQUE NOT NULL, tier TEXT NOT NULL DEFAULT 'free', status TEXT NOT NULL DEFAULT 'active', max_users INTEGER NOT NULL DEFAULT 5, deployment_mode TEXT NOT NULL DEFAULT 'shared', applied_cmd_seq INTEGER NOT NULL DEFAULT 0, applied_cred_seq INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL);",
    );
    await b.DB.exec('CREATE TABLE IF NOT EXISTS processed_cmd_events (event_id TEXT PRIMARY KEY, cmd_type TEXT NOT NULL, processed_at INTEGER NOT NULL);');
    await b.DB.exec('CREATE TABLE IF NOT EXISTS parked_cmd_events (id TEXT PRIMARY KEY, envelope TEXT NOT NULL, reason TEXT NOT NULL, received_at INTEGER NOT NULL);');
    await b.DB.exec(
        "CREATE TABLE IF NOT EXISTS sync_outbox (id TEXT PRIMARY KEY, event_type TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_tried_at INTEGER, last_error TEXT);",
    );
    await b.DB.exec('CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT, archived_at INTEGER);');
    await b.DB.exec(MIGRATION_BATCHES_TEST_DDL);
    await b.DB.exec(MIGRATION_ROWS_TEST_DDL);
    await b.DB.exec(AUDIT_LOGS_TEST_DDL);
}

async function seedWaitingTemplateRun(batchId = BATCH): Promise<void> {
    await b.DB.prepare(
        'INSERT INTO migration_batches (id, tenant_id, created_by, intent, vendor, adapter_name, adapter_version, manifest, status, created_at, source_key, expires_at, upload_authorized_by, upload_authorized_at, upload_authorization_version, staff_access_authorized_by, staff_access_authorized_at, staff_access_authorization_version)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
        batchId, TENANT, 'u1', 'templates.create', 'csv_generic', 'none', '0',
        JSON.stringify({ warnings: [] }), 'needs_assistance', Date.now(),
        `tenants/${TENANT}/migration/x.xlsx`, Date.now() + 86_400_000,
        'u1', Date.now(), 'v1', 'u1', Date.now(), 'v1',
    ).run();
}

async function clearAll(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'sync_outbox', 'migration_batches', 'migration_rows', 'audit_logs']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
    const listed = await b.EXPORTS_BUCKET.list({ prefix: 'migration-deliveries/' });
    for (const o of listed.objects) await b.EXPORTS_BUCKET.delete(o.key);
}

async function rowCount(): Promise<number> {
    const r = await b.DB.prepare('SELECT count(*) AS n FROM migration_rows WHERE batch_id = ?').bind(BATCH).first<{ n: number }>();
    return r?.n ?? 0;
}

async function markerCount(): Promise<number> {
    return (await b.DB.prepare('SELECT count(*) AS n FROM processed_cmd_events').first<{ n: number }>())?.n ?? 0;
}

async function replyCount(): Promise<number> {
    return (await b.DB.prepare('SELECT count(*) AS n FROM sync_outbox').first<{ n: number }>())?.n ?? 0;
}

async function statusOf(batchId = BATCH): Promise<string | undefined> {
    return (await b.DB.prepare('SELECT status FROM migration_batches WHERE id = ?').bind(batchId).first<{ status: string }>())?.status;
}

async function objectExists(key: string): Promise<boolean> {
    return (await b.EXPORTS_BUCKET.head(key)) !== null;
}

describe('cmd.migration.deliver by reference, end to end', { timeout: 60_000 }, () => {
    beforeAll(async () => {
        await seedSchema();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)')
            .bind(TENANT, 'ref-a', Date.now()).run();
        await import('../../server/portal/apply-migration-commands');
    });
    beforeEach(clearAll);

    it('stages a ~1.5 MB single-template bundle, and the command that carried it fits in a queue message', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 1_500_000 });
        expect(serializedBytes(bundle)).toBeGreaterThanOrEqual(1_500_000);
        const ref = await stage(bundle);
        const { bucket, calls } = spyBucket();

        const refCommand = envelope({ bundleRef: ref });
        const inlineCommand = envelope({ bundle });
        // The command is what rides the queue. By reference it is a few hundred
        // bytes; inline it is the control that shows the limit is real.
        expect(serializedBytes(refCommand)).toBeLessThan(QUEUE_MESSAGE_LIMIT_BYTES);
        expect(serializedBytes(inlineCommand)).toBeGreaterThan(QUEUE_MESSAGE_LIMIT_BYTES);

        expect(await applyCmdEnvelope(b.DB, undefined, refCommand, undefined, { exports: bucket as unknown as R2Bucket })).toBe('applied');

        // One template, one staged row carrying the template's own JSON.
        expect(await rowCount()).toBe(1);
        const row = await b.DB.prepare('SELECT payload FROM migration_rows WHERE batch_id = ?').bind(BATCH).first<{ payload: string }>();
        // Compared as data: the parser re-emits keys in schema order, so the text
        // is not byte-identical to the generator's, but nothing may be lost.
        expect(JSON.parse(row!.payload)).toEqual(bundle.templates[0]);

        // The accounting the bundle declared is what was staged:
        // readFromSource === emitted + dropped, and emitted is the row count.
        const batch = await b.DB.prepare('SELECT manifest, status FROM migration_batches WHERE id = ?').bind(BATCH).first<{ manifest: string; status: string }>();
        expect(batch?.status).toBe('staged');
        const counts = (JSON.parse(batch!.manifest) as { counts: { template: { readFromSource: number; emitted: number; dropped: unknown[] } } }).counts.template;
        expect(counts.readFromSource).toBe(counts.emitted + counts.dropped.length);
        expect(counts.emitted).toBe(await rowCount());

        // Read once, deleted once, and gone.
        expect(calls).toEqual({ get: 1, delete: 1 });
        expect(await objectExists(ref.key)).toBe(false);

        // The audit row says the route, not the object.
        const audit = await b.DB.prepare("SELECT metadata FROM audit_logs WHERE action = 'migration.delivered'").first<{ metadata: string }>();
        const meta = JSON.parse(audit!.metadata) as Record<string, unknown>;
        expect(meta['viaRef']).toBe(true);
        expect(meta['rows']).toBe(1);
        expect(audit!.metadata).not.toContain('migration-deliveries');
        expect(audit!.metadata).not.toContain(ref.sha256);
    });

    it('an inline delivery records no viaRef', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundle }))).toBe('applied');
        const audit = await b.DB.prepare("SELECT metadata FROM audit_logs WHERE action = 'migration.delivered'").first<{ metadata: string }>();
        expect(JSON.parse(audit!.metadata)).not.toHaveProperty('viaRef');
    });

    it('refuses another workspace\'s object without reading it, and leaves that object alone', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        const foreign = await stage(bundle, OTHER_TENANT, BATCH);
        const { bucket, calls } = spyBucket();

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: foreign }), undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/outside the prefix/);

        expect(calls).toEqual({ get: 0, delete: 0 });
        expect(await objectExists(foreign.key)).toBe(true);
        expect(await rowCount()).toBe(0);
        // The dedup marker was rolled back, so the sender can correct and resend.
        const marker = await b.DB.prepare('SELECT count(*) AS n FROM processed_cmd_events').first<{ n: number }>();
        expect(marker?.n).toBe(0);
    });

    it('refuses another run\'s object in the same workspace without reading it', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        const foreign = await stage(bundle, TENANT, OTHER_BATCH);
        const { bucket, calls } = spyBucket();

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: foreign }), undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/outside the prefix/);

        expect(calls).toEqual({ get: 0, delete: 0 });
        expect(await objectExists(foreign.key)).toBe(true);
        expect(await rowCount()).toBe(0);
    });

    it('a missing object fails the command, stages nothing, and leaves the run waiting', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        const ref = await stage(bundle);
        await b.EXPORTS_BUCKET.delete(ref.key);
        const { bucket } = spyBucket();

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/does not exist/);
        expect(await rowCount()).toBe(0);
        const batch = await b.DB.prepare('SELECT status FROM migration_batches WHERE id = ?').bind(BATCH).first<{ status: string }>();
        expect(batch?.status).toBe('needs_assistance');
    });

    it('a failed delete does not undo the delivery', async () => {
        await seedWaitingTemplateRun();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket, calls } = spyBucket({ failDelete: true });

        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, { exports: bucket as unknown as R2Bucket })).toBe('applied');

        expect(calls.delete).toBe(1);
        expect(await rowCount()).toBe(1);
        expect(await objectExists(ref.key)).toBe(true);
    });

    it('a failure after staging leaves the object in place and rolls the marker back; the redelivery stages nothing twice', async () => {
        await seedWaitingTemplateRun();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket, calls } = spyBucket();
        const buckets = { exports: bucket as unknown as R2Bucket };
        // The consumer advances the tenant's sequence AFTER the rows are staged.
        // A trigger makes that step fail, which is the post-staging failure
        // that rolls the dedup marker back.
        // The advance only touches a row whose counter is behind the command.
        await b.DB.prepare('UPDATE tenants SET applied_cmd_seq = 0 WHERE id = ?').bind(TENANT).run();
        await b.DB.exec("CREATE TRIGGER fail_seq_advance BEFORE UPDATE ON tenants BEGIN SELECT RAISE(ABORT, 'seq advance refused'); END;");
        let failure: unknown;
        try {
            failure = await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, buckets)
                .then(() => undefined, (e: unknown) => e);
        } finally {
            await b.DB.exec('DROP TRIGGER fail_seq_advance;');
        }
        // The failure is the sequence update's, and the trigger is its cause.
        expect(String((failure as Error | undefined)?.message)).toMatch(/update "tenants" set "applied_cmd_seq"/);
        expect(String((failure as { cause?: { message?: string } } | undefined)?.cause?.message)).toMatch(/seq advance refused/);
        // The delivery landed, the marker is gone so the queue will redeliver,
        // and the object is still there for that redelivery.
        expect(await rowCount()).toBe(1);
        expect((await b.DB.prepare('SELECT count(*) AS n FROM processed_cmd_events').first<{ n: number }>())?.n).toBe(0);
        expect(await objectExists(ref.key)).toBe(true);
        expect(calls.delete).toBe(0);

        // Redelivery: the run is no longer waiting, so it is refused by name,
        // nothing is staged twice, and the now-useless object is removed
        // without having been read.
        const readsBefore = calls.get;
        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, buckets))
            .rejects.toThrow(/This import is not waiting for a converted file/);
        expect(await rowCount()).toBe(1);
        expect(calls.get).toBe(readsBefore);
        expect(await objectExists(ref.key)).toBe(false);
        // The refused attempt left no marker (so the queue may retry it into the
        // same refusal until it dead-letters), emitted no reply, and did not
        // touch the run, which stays staged from the first attempt.
        expect(await markerCount()).toBe(0);
        expect(await replyCount()).toBe(0);
        expect(await statusOf()).toBe('staged');
    });

    it('POSITIVE CONTROL — with nothing failing, the object is deleted only after the reply is written', async () => {
        await seedWaitingTemplateRun();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket } = spyBucket();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), queue, { exports: bucket as unknown as R2Bucket })).toBe('applied');
        const reply = await b.DB.prepare("SELECT count(*) AS n FROM sync_outbox WHERE event_type = 'reply.migration.delivered'").first<{ n: number }>();
        expect(reply?.n).toBe(1);
        expect(await objectExists(ref.key)).toBe(false);
    });

    it.each([
        ['declined', 'declined'],
        ['expired', 'expired'],
        ['already staged', 'staged'],
    ])('a run that is %s: the command is refused by name, the object is removed unread', async (_label, status) => {
        await seedWaitingTemplateRun();
        await b.DB.prepare('UPDATE migration_batches SET status = ? WHERE id = ?').bind(status, BATCH).run();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket, calls } = spyBucket();

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/This import is not waiting for a converted file/);

        expect(calls).toEqual({ get: 0, delete: 1 });
        expect(await objectExists(ref.key)).toBe(false);
        expect(await rowCount()).toBe(0);
        // Refused: no marker left behind, no reply sent, the run's status as it was.
        expect(await markerCount()).toBe(0);
        expect(await replyCount()).toBe(0);
        expect(await statusOf()).toBe(status);
    });

    it('POSITIVE CONTROL for the refusals above — a waiting run leaves a marker, a reply and a staged status', async () => {
        await seedWaitingTemplateRun();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket } = spyBucket();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), queue, { exports: bucket as unknown as R2Bucket });
        expect(await markerCount()).toBe(1);
        expect(await replyCount()).toBe(1);
        expect(await statusOf()).toBe('staged');
    });

    it('a stale sequence number does not drop a migration delivery: it applies and releases its object', async () => {
        // Migration commands are exempt from the stale guard (see isSubjectCmd in
        // the consumer), so a stale command carrying a reference is never
        // "dropped with its object left behind": it is applied like any other.
        await seedWaitingTemplateRun();
        await b.DB.prepare('UPDATE tenants SET applied_cmd_seq = 99 WHERE id = ?').bind(TENANT).run();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket } = spyBucket();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        expect(await applyCmdEnvelope(b.DB, undefined, { ...envelope({ bundleRef: ref }), tenantseq: 1 }, queue, { exports: bucket as unknown as R2Bucket }))
            .toBe('applied');
        expect(await rowCount()).toBe(1);
        expect(await objectExists(ref.key)).toBe(false);
        expect(await markerCount()).toBe(1);
        expect(await replyCount()).toBe(1);
        // CONTROL: the counter was not moved backwards by the stale command.
        const seq = await b.DB.prepare('SELECT applied_cmd_seq AS s FROM tenants WHERE id = ?').bind(TENANT).first<{ s: number }>();
        expect(seq?.s).toBe(99);
    });

    it('an already-processed command is a duplicate: its object is left alone, nothing is staged or sent', async () => {
        await seedWaitingTemplateRun();
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const { bucket } = spyBucket();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        const buckets = { exports: bucket as unknown as R2Bucket };
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), queue, buckets)).toBe('applied');
        // The first run released its object. Put the same bytes back so the
        // duplicate has something that a wrong implementation could delete.
        expect(await objectExists(ref.key)).toBe(false);
        await b.EXPORTS_BUCKET.put(ref.key, new TextEncoder().encode('sentinel'));
        const repliesAfterFirst = await replyCount();

        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), queue, buckets)).toBe('duplicate');

        expect(await objectExists(ref.key)).toBe(true);
        expect(await rowCount()).toBe(1);
        expect(await markerCount()).toBe(1);
        expect(await replyCount()).toBe(repliesAfterFirst);
    });

    it('a throw before staging on the post-apply path leaves the object for the retry; the retry then releases it', async () => {
        await seedWaitingTemplateRun();
        const good = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        const ref = await stage(good);
        // Corrupt the stored bytes: same key and size, different content.
        const bad = new Uint8Array(ref.bytes).fill(32);
        await b.EXPORTS_BUCKET.put(ref.key, bad);
        const { bucket, calls } = spyBucket();
        const buckets = { exports: bucket as unknown as R2Bucket };

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, buckets))
            .rejects.toThrow(/object content does not match the declared hash/);
        expect(calls.delete).toBe(0);
        expect(await objectExists(ref.key)).toBe(true);
        expect(await rowCount()).toBe(0);
        expect(await markerCount()).toBe(0);
        expect(await replyCount()).toBe(0);
        expect(await statusOf()).toBe('needs_assistance');

        // CONTROL: the sender repairs the object; the retry stages and releases.
        await stage(good);
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: ref }), undefined, buckets)).toBe('applied');
        expect(await objectExists(ref.key)).toBe(false);
        expect(await rowCount()).toBe(1);
    });

    it('releasing with no exports bucket bound does not throw; with one bound it deletes', async () => {
        const ref = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }));
        const data = { tenantId: TENANT, batchId: BATCH, bundleRef: ref };
        await expect(releaseDeliveredBundle(data, undefined)).resolves.toBeUndefined();
        expect(await objectExists(ref.key)).toBe(true);
        const { bucket } = spyBucket();
        await releaseDeliveredBundle(data, bucket);
        expect(await objectExists(ref.key)).toBe(false);
    });

    it('an inline delivery with no exports bucket bound still applies (nothing to release)', async () => {
        await seedWaitingTemplateRun();
        const bundle = buildSyntheticTemplateBundle({ targetBytes: 20_000 });
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ bundle }))).toBe('applied');
        expect(await rowCount()).toBe(1);
    });

    it.each([
        ['batch id', { batchId: 'batch/x', tenantId: TENANT }],
        ['tenant id', { batchId: BATCH, tenantId: 'tenant/x' }],
    ])('a slash in the %s reaching the not-waiting path is refused before any bucket call', async (_label, ids) => {
        // Seed a declined run whose ids contain a slash, so the command gets
        // past the run lookup and reaches the ownership check.
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)').bind(ids.tenantId, `s-${ids.tenantId.replace('/', '-')}`, Date.now()).run();
        await b.DB.prepare(
            'INSERT INTO migration_batches (id, tenant_id, created_by, intent, vendor, adapter_name, adapter_version, manifest, status, created_at, staff_access_authorized_by, staff_access_authorized_at, staff_access_authorization_version)'
            + " VALUES (?, ?, 'u1', 'templates.create', 'csv_generic', 'none', '0', '{}', 'declined', ?, 'u1', ?, 'v1')",
        ).bind(ids.batchId, ids.tenantId, Date.now(), Date.now()).run();
        const key = `migration-deliveries/${ids.tenantId}/${ids.batchId}/${'a'.repeat(64)}.json`;
        await b.EXPORTS_BUCKET.put(key, new TextEncoder().encode('x'));
        const { bucket, calls } = spyBucket();
        const command = envelope({ ...ids, bundleRef: { key, bytes: 1, sha256: 'a'.repeat(64) } });

        await expect(applyCmdEnvelope(b.DB, undefined, command, undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/may not contain a slash/);

        expect(calls).toEqual({ get: 0, delete: 0 });
        expect(await objectExists(key)).toBe(true);
    });

    it('a foreign reference on a run that is no longer waiting is refused by ownership and its object is NOT deleted', async () => {
        await seedWaitingTemplateRun();
        await b.DB.prepare("UPDATE migration_batches SET status = 'declined' WHERE id = ?").bind(BATCH).run();
        const foreign = await stage(buildSyntheticTemplateBundle({ targetBytes: 20_000 }), OTHER_TENANT, BATCH);
        const { bucket, calls } = spyBucket();

        await expect(applyCmdEnvelope(b.DB, undefined, envelope({ bundleRef: foreign }), undefined, { exports: bucket as unknown as R2Bucket }))
            .rejects.toThrow(/outside the prefix/);

        expect(calls).toEqual({ get: 0, delete: 0 });
        expect(await objectExists(foreign.key)).toBe(true);
    });
});
