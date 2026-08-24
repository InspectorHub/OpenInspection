/**
 * The three `cmd.migration.*` commands, through the REAL consumer in workerd.
 *
 * ── Why delivery is a command and not the POST it already had ───────────────
 * The three admin POSTs still exist and still work for a person signed into the
 * workspace. What they cannot be is the operator's transport, and the reason is
 * not tidiness: delivery WRITES INTO A TENANT, the payload can be large, it can
 * fail halfway, and it must be retryable WITHOUT APPLYING TWICE. The command bus
 * already has dedup (`processed_cmd_events`), a staleness guard, parking
 * (`parked_cmd_events`) and replies, and the console dashboard already shows the
 * parked count with a re-process control. A new command type inherits all of it.
 *
 * ── Why real workerd ────────────────────────────────────────────────────────
 * Every one of those properties is a property of the CONSUMER PIPELINE — the
 * dedup insert, the stale guard, the park write, the reply on the sync queue.
 * A test that called an applier directly would exercise none of them, and the
 * dedup assertion below would pass for a consumer that applies nothing.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { applyCmdEnvelope } from '../../server/portal/cmd-consumer';
import {
    MIGRATION_BATCHES_TEST_DDL, MIGRATION_ROWS_TEST_DDL, AUDIT_LOGS_TEST_DDL,
} from '../helpers/inline-ddl';

const b = env as unknown as { DB: D1Database };

const TENANT = 'tenant-cmd-mig';
const BATCH = 'batch-cmd-mig';
const ACTOR = { platformAdminId: 'pa-9', email: 'ops@inspectorhub.io' };

/** One contact, in the normalised import format a person converts a file into. */
const BUNDLE = {
    formatVersion: 1,
    manifest: {
        source: { vendor: 'csv_generic' },
        adapter: { name: 'staff-conversion', version: '1' },
        counts: {
            template: { readFromSource: 0, emitted: 0, dropped: [] },
            contact: { readFromSource: 1, emitted: 1, dropped: [] },
            member: { readFromSource: 0, emitted: 0, dropped: [] },
        },
        warnings: [],
    },
    templates: [],
    contacts: [{ name: 'Alice Ng', email: 'alice@example.test', type: 'client' }],
    members: [],
};

function envelope(over: Record<string, unknown> = {}) {
    return {
        specversion: '1.0',
        id: 'cmd-mig-1',
        type: 'io.inspectorhub.cmd.migration.deliver',
        source: 'portal',
        time: '2026-08-25T10:00:00.000Z',
        dataschema: 'cmd-migration-deliver/v1',
        tenantseq: 1,
        replyto: `import:${BATCH}`,
        data: { tenantId: TENANT, batchId: BATCH, bundle: BUNDLE, actor: ACTOR },
        ...over,
    };
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
    // The staging step asks whether each incoming contact collides with one the
    // workspace already has. Four columns are READ and none is written, so this
    // is deliberately not a shared DDL constant: a partial table cannot park an
    // insert, which is the drift the shared ones exist to prevent.
    await b.DB.exec('CREATE TABLE IF NOT EXISTS contacts (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT, archived_at INTEGER);');
    await b.DB.exec(MIGRATION_BATCHES_TEST_DDL);
    await b.DB.exec(MIGRATION_ROWS_TEST_DDL);
    await b.DB.exec(AUDIT_LOGS_TEST_DDL);
}

/** A run parked in `needs_assistance`, with the staff-access authorisation on it. */
async function seedWaitingRun(over: { staffAccess?: boolean } = {}): Promise<void> {
    const authorised = over.staffAccess !== false;
    await b.DB.prepare(
        'INSERT INTO migration_batches (id, tenant_id, created_by, intent, vendor, adapter_name, adapter_version, manifest, status, created_at, source_key, expires_at, upload_authorized_by, upload_authorized_at, upload_authorization_version, staff_access_authorized_by, staff_access_authorized_at, staff_access_authorization_version)'
        + ' VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
        BATCH, TENANT, 'u1', 'contacts.import', 'csv_generic', 'none', '0',
        JSON.stringify({ warnings: [] }), 'needs_assistance', Date.now(),
        `tenants/${TENANT}/migration/x.csv`, Date.now() + 86_400_000,
        'u1', Date.now(), 'v1',
        authorised ? 'u1' : null, authorised ? Date.now() : null, authorised ? 'v1' : null,
    ).run();
}

async function clearTables(): Promise<void> {
    for (const t of ['processed_cmd_events', 'parked_cmd_events', 'sync_outbox', 'migration_batches', 'migration_rows', 'audit_logs']) {
        await b.DB.exec(`DELETE FROM ${t};`);
    }
}

async function stagedRowCount(): Promise<number> {
    const row = await b.DB.prepare('SELECT count(*) AS n FROM migration_rows WHERE batch_id = ?')
        .bind(BATCH).first<{ n: number }>();
    return row?.n ?? 0;
}

async function parkedCount(): Promise<number> {
    const row = await b.DB.prepare('SELECT count(*) AS n FROM parked_cmd_events').first<{ n: number }>();
    return row?.n ?? 0;
}

async function lastAuditRow() {
    return b.DB.prepare('SELECT action, actor_kind, platform_actor_id, user_id, tenant_id FROM audit_logs ORDER BY rowid DESC LIMIT 1')
        .first<{ action: string; actor_kind: string; platform_actor_id: string | null; user_id: string | null; tenant_id: string }>();
}

async function batchStatus(): Promise<string | undefined> {
    const row = await b.DB.prepare('SELECT status FROM migration_batches WHERE id = ?').bind(BATCH).first<{ status: string }>();
    return row?.status;
}

/** Replies ride the sync outbox; read what the consumer wrote there. */
async function replies(): Promise<Array<{ eventType: string; payload: Record<string, unknown> }>> {
    const { results } = await b.DB.prepare('SELECT event_type, payload FROM sync_outbox ORDER BY rowid').all<{ event_type: string; payload: string }>();
    return results.map((r) => ({ eventType: r.event_type, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

/**
 * ⚠️ A RAISED TIMEOUT, and the reason is not "these are slow tests".
 *
 * Run alone every assertion here finishes in tens of milliseconds. Run as part
 * of the whole `tests/workers` suite — 32 files, each its own workerd isolate,
 * contending for one machine — the FIRST test in this file blew the 5s default
 * while it paid a one-off cost nothing else pays: the applier is reached by a
 * dynamic import, and it pulls in the bundle parser and the staging service on
 * whichever test happens to run first.
 *
 * That timeout did not fail alone. The timed-out test's second delivery was
 * still in flight when the next test began, so it staged its row into a table
 * `beforeEach` had just cleared and the POSITIVE CONTROL read three rows where
 * it expected two — a cascade that looks exactly like a dedup bug and is not
 * one. The `beforeAll` below pays the import cost up front so no single test
 * carries it, and the timeout covers the contention that remains.
 */
describe('cmd.migration.* through the real consumer', { timeout: 30_000 }, () => {
    beforeAll(async () => {
        await seedSchema();
        await b.DB.prepare('INSERT OR IGNORE INTO tenants (id, slug, created_at) VALUES (?, ?, ?)')
            .bind(TENANT, 'cmd-mig', Date.now()).run();
        // Warm the dynamically-imported applier and everything under it, so the
        // first assertion measures the consumer rather than a module graph.
        await import('../../server/portal/apply-migration-commands');
    });
    beforeEach(clearTables);

    it('applies once when the same command is delivered twice', async () => {
        await seedWaitingRun();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope())).toBe('applied');
        expect(await applyCmdEnvelope(b.DB, undefined, envelope())).toBe('duplicate');
        expect(await stagedRowCount()).toBe(1);
    });

    it('POSITIVE CONTROL — a DIFFERENT command does apply again', async () => {
        // Without this, the dedup assertion above passes for a consumer that
        // applies nothing at all.
        await seedWaitingRun();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope())).toBe('applied');
        // The run is no longer waiting, so a second delivery is refused by the
        // stager rather than by dedup — assert on the ROW COUNT, which is what
        // "applied twice" would actually look like.
        await b.DB.prepare("UPDATE migration_batches SET status = 'needs_assistance' WHERE id = ?").bind(BATCH).run();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ id: 'cmd-mig-2', tenantseq: 2 }))).toBe('applied');
        expect(await stagedRowCount()).toBe(2);
    });

    it('records the PLATFORM actor, not the tenant admin', async () => {
        await seedWaitingRun();
        await applyCmdEnvelope(b.DB, undefined, envelope());
        const row = await lastAuditRow();
        expect(row?.action).toBe('migration.delivered');
        expect(row?.actor_kind).toBe('platform_staff');
        expect(row?.platform_actor_id).toBe(ACTOR.platformAdminId);
        // And NOT the customer's own administrator. A row that named `created_by`
        // here would be the exact defect this whole seam exists to end: the same
        // action by the workspace's owner and by a support session would produce
        // identical rows.
        expect(row?.user_id).toBeNull();
        // Filed under the workspace whose file it is, taken off the ROW.
        expect(row?.tenant_id).toBe(TENANT);
    });

    it('parks an unknown migration command rather than failing the batch', async () => {
        await seedWaitingRun();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            type: 'io.inspectorhub.cmd.migration.nonsense',
            dataschema: 'cmd-migration-nonsense/v1',
        }))).toBe('parked');
        expect(await parkedCount()).toBe(1);
        expect(await stagedRowCount()).toBe(0);
    });

    it('replies `delivered` so the console stops showing the run as waiting', async () => {
        await seedWaitingRun();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        await applyCmdEnvelope(b.DB, undefined, envelope(), queue);
        const reply = (await replies()).find((r) => r.eventType === 'reply.migration.delivered');
        expect(reply, 'no reply was emitted — the console would show the run as waiting forever').toBeDefined();
        expect(reply!.payload['batchId']).toBe(BATCH);
        expect(reply!.payload['replyto']).toBe(`import:${BATCH}`);
        expect(reply!.payload['correlationId']).toBe('cmd-mig-1');
    });

    it('a decline moves the run and replies with the reason', async () => {
        await seedWaitingRun();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            id: 'cmd-mig-decline', type: 'io.inspectorhub.cmd.migration.decline',
            dataschema: 'cmd-migration-decline/v1',
            data: { tenantId: TENANT, batchId: BATCH, reason: 'The export contains no importable records.', actor: ACTOR },
        }), queue)).toBe('applied');
        expect(await batchStatus()).toBe('declined');
        const reply = (await replies()).find((r) => r.eventType === 'reply.migration.declined');
        expect(reply!.payload['reason']).toBe('The export contains no importable records.');
        expect((await lastAuditRow())?.action).toBe('migration.declined');
    });

    it('an acknowledgement does NOT move the run — picking a file up is not converting it', async () => {
        await seedWaitingRun();
        const queue = { send: async () => {} } as unknown as Queue<never>;
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({
            id: 'cmd-mig-ack', type: 'io.inspectorhub.cmd.migration.acknowledge',
            dataschema: 'cmd-migration-acknowledge/v1',
            data: { tenantId: TENANT, batchId: BATCH, actor: ACTOR },
        }), queue)).toBe('applied');
        expect(await batchStatus()).toBe('needs_assistance');
        expect(await stagedRowCount()).toBe(0);
        const reply = (await replies()).find((r) => r.eventType === 'reply.migration.acknowledged');
        expect(reply, 'nothing told the console the run had been picked up').toBeDefined();
        expect((await lastAuditRow())?.actor_kind).toBe('platform_staff');
    });

    it('THE PRECONDITION — a run nobody authorised a person to open receives nothing', async () => {
        // `assertStaffAccessAuthorized` already governs the POST. Reaching the
        // same write through a queue must not be a way around it, and a command
        // seam is exactly where a rule enforced in a route handler goes missing.
        await seedWaitingRun({ staffAccess: false });
        await expect(applyCmdEnvelope(b.DB, undefined, envelope())).rejects.toThrow();
        expect(await stagedRowCount()).toBe(0);
    });

    it('POSITIVE CONTROL — the same command IS applied once the authorisation is on the run', async () => {
        await seedWaitingRun({ staffAccess: true });
        expect(await applyCmdEnvelope(b.DB, undefined, envelope())).toBe('applied');
        expect(await stagedRowCount()).toBe(1);
    });

    it('is EXEMPT from the stale guard — an unrelated command must not silently drop a delivery', async () => {
        // The guard answers "has this TENANT-FIELD STATE been superseded?" and
        // dropping an older seat-count write is exactly right. A delivery is not
        // state: left guarded, a quota sync that merely OVERTOOK it in the queue
        // would drop the delivery, with no reply, and the console would show the
        // run as waiting until its retention clock ran out.
        await seedWaitingRun();
        await b.DB.prepare('UPDATE tenants SET applied_cmd_seq = 99 WHERE id = ?').bind(TENANT).run();
        expect(await applyCmdEnvelope(b.DB, undefined, envelope({ tenantseq: 1 }))).toBe('applied');
        expect(await stagedRowCount()).toBe(1);
    });
});
