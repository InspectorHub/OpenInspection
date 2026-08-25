/**
 * `migration.assistance_requested` — the event that tells the deployment
 * operator a file is sitting in a run waiting for a person.
 *
 * WHY THIS RUNS IN REAL WORKERD
 * -----------------------------
 * Everything this event is for happens on the wire. `append()` writes a row,
 * `toCloudEvent` turns that row into an envelope, the queue carries it, and the
 * receiving side keys on the SERIALIZED `type` and `dataschema` — so a test that
 * stopped at the row, or at the constant the emitter passed in, would prove
 * nothing about the only two strings that matter.
 *
 * ⚠️ THE ASSERTIONS BELOW READ THE DELIVERED MESSAGE, NEVER THE INPUT.
 * A sibling event shipped broken for its entire life while its spec stayed
 * green, because the spec asserted the emitter's own literal back at itself: the
 * producer kept a hand-written list holding an already-prefixed name,
 * `toCloudEvent` prefixed it again, and every delivery arrived as
 * `io.inspectorhub.io.inspectorhub.tenant.…`. Portal knew neither spelling and
 * parked all of them — silently, because parking IS the designed answer to an
 * unknown type. Nothing in this file may assert a string it also supplied.
 */
import { env } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { OutboxService, publishRow, type OutboxRow } from '../../server/portal/outbox.service';
import { toCloudEvent } from '../../server/lib/sync-events/envelope';

interface TestBindings {
    DB: D1Database;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    SYNC_QUEUE: Queue<any>;
}
const b = env as unknown as TestBindings;

const TENANT = 'tenant-assist-1';
const BATCH = 'batch-assist-1';
const UPLOADED_AT = Date.parse('2026-08-25T09:00:00.000Z');
const EXPIRES_AT = Date.parse('2026-11-23T09:00:00.000Z');

/** The payload the route builds when it opens a waiting run. */
const PAYLOAD = {
    tenantId: TENANT,
    batchId: BATCH,
    vendor: null,
    uploadedAt: UPLOADED_AT,
    expiresAt: EXPIRES_AT,
    secondaryUseAuthorised: false,
};

async function seedSchema(): Promise<void> {
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

/** Poll the delivery log until the message id appears (queue delivery is async).
 *  Every iteration awaits real I/O — workerd only advances its clock on I/O, so
 *  a busy loop here would spin forever against a deadline that never moves. */
async function waitForDelivery(id: string, timeoutMs = 5000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const row = await b.DB.prepare('SELECT id FROM test_queue_log WHERE id = ?').bind(id).first();
        if (row) return true;
        await new Promise((r) => setTimeout(r, 25));
    }
    return false;
}

/** The production path from di.ts: append, then publish the returned row. */
async function appendAndPublish(): Promise<string> {
    let published: OutboxRow | undefined;
    const svc = new OutboxService(b.DB, (row) => { published = row; });
    const id = await svc.append({ type: 'migration.assistance_requested', payload: PAYLOAD });
    expect(published, 'append() did not fire the publish hook').toBeDefined();
    await publishRow(b.DB, b.SYNC_QUEUE, published!);
    return id;
}

async function deliveredEnvelope(id: string): Promise<{ type: string; dataschema: string; source: string; specversion: string; data: Record<string, unknown> }> {
    expect(await waitForDelivery(id), 'envelope never reached the queue consumer').toBe(true);
    const logged = await b.DB.prepare('SELECT body FROM test_queue_log WHERE id = ?')
        .bind(id).first<{ body: string }>();
    return JSON.parse(logged!.body) as ReturnType<typeof toCloudEvent> & { data: Record<string, unknown> };
}

describe('migration.assistance_requested on the sync queue', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('reaches the queue consumer with the SINGLE-prefixed wire type', async () => {
        const id = await appendAndPublish();
        const envelope = await deliveredEnvelope(id);
        // Read off the delivered message. `io.inspectorhub.` appears exactly
        // once — the doubled-prefix failure is a string this assertion can see.
        expect(envelope.type).toBe('io.inspectorhub.migration.assistance_requested');
    });

    it('carries the versioned dataschema portal keys on', async () => {
        const id = await appendAndPublish();
        const envelope = await deliveredEnvelope(id);
        expect(envelope.dataschema).toBe('migration-assistance-requested/v1');
        expect(envelope.specversion).toBe('1.0');
        expect(envelope.source).toBe('core');
    });

    it('carries every field the console needs, off the wire', async () => {
        const id = await appendAndPublish();
        const envelope = await deliveredEnvelope(id);
        expect(envelope.data).toEqual(PAYLOAD);
    });

    it('THE ONE THE CONSOLE CANNOT DO WITHOUT — the retention clock survives the round trip', async () => {
        // The console shows days left against this number. `expiresAt` is what
        // makes a waiting queue a queue with a deadline rather than a list, and
        // JSON round-tripping an epoch through a `Date` column is exactly where
        // a number turns into a string nobody can subtract.
        const id = await appendAndPublish();
        const envelope = await deliveredEnvelope(id);
        expect(typeof envelope.data['expiresAt']).toBe('number');
        expect(envelope.data['expiresAt']).toBe(EXPIRES_AT);
    });

    it('the row it left behind is marked published, not stuck pending', async () => {
        const id = await appendAndPublish();
        const row = await b.DB.prepare('SELECT status, event_type FROM sync_outbox WHERE id = ?')
            .bind(id).first<{ status: string; event_type: string }>();
        expect(row?.status).toBe('published');
        // The STORED type is the unprefixed registry key; the prefix belongs to
        // the wire and to nowhere else.
        expect(row?.event_type).toBe('migration.assistance_requested');
    });

    it('NEGATIVE CONTROL — the already-prefixed spelling cannot be serialized', () => {
        // If this ever stops throwing, the registry has grown a second name for
        // one event and the doubled-prefix defect is back.
        expect(() => toCloudEvent({
            id: 'x', eventType: 'io.inspectorhub.migration.assistance_requested',
            payload: '{}', createdAt: new Date(),
        })).toThrow(/unregistered event type/);
    });
});
