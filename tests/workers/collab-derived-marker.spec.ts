/**
 * The `derived-from-d1` marker, and replacing a document that only the database ever shaped (workerd).
 *
 * An object created after pinning builds its document from the database. Until a client changes it, that document is
 * recoverable from the database, so a copy of the older, fuller document may replace it. The first client edit clears the
 * marker for good. Every refusal is paired with a replacement that does go through.
 */

import { env, runInDurableObject, runDurableObjectAlarm } from 'cloudflare:test';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import { applyItemPatch, projectResults, seedResultsDoc } from '@core/field-ui/shared/results-doc';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';
import { bytesToBase64, type StateExport } from '../../server/durable-objects/inspection-doc-state-transfer';

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as typeof env & TestBindings;

const TENANT = 't-derived';
const INSPECTION = 'i-derived';
const REPORT = 'r-derived';
const KEY = '_default:s1:item1';
const IDENTITY_HEADERS = { 'x-tenant-id': TENANT, 'x-inspection-id': INSPECTION, 'x-report-id': REPORT, 'content-type': 'application/json' };

function stub(name: string) {
    return b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(name));
}

/** A document with one rated item: what the database projection of a worked-on report looks like. */
function builtDoc(): Y.Doc {
    const d = new Y.Doc();
    seedResultsDoc(d, [{ findingKey: KEY }]);
    applyItemPatch(d, KEY, 'rating', 'defect');
    return d;
}

async function seedDatabase(): Promise<void> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
    await b.DB.prepare('INSERT INTO inspections (id, tenant_id, template_snapshot) VALUES (?, ?, ?)').bind(INSPECTION, TENANT, null).run();
    await b.DB
        .prepare('INSERT INTO inspection_results (id, tenant_id, inspection_id, data, last_synced_at, report_id) VALUES (?, ?, ?, ?, ?, ?)')
        .bind('row-1', TENANT, INSPECTION, JSON.stringify(projectResults(builtDoc())), Date.now(), REPORT)
        .run();
}

/** Opens the object the way the first request does: identity headers, then the one-time database load. No edit follows. */
async function openFromDatabase(name: string): Promise<void> {
    const res = await stub(name).fetch('https://do.test/followup', { method: 'POST', headers: IDENTITY_HEADERS, body: JSON.stringify({ itemId: 'not-carried' }) });
    expect(res.status).toBe(404);
    await runDurableObjectAlarm(stub(name));
    // The debounce timer the edit armed is what says "changes are waiting to be stored"; let it run out.
    await new Promise<void>((resolve) => setTimeout(resolve, 1300));
}

async function exported(name: string): Promise<StateExport> {
    return (await (await stub(name).fetch('https://do.test/state-export')).json()) as StateExport;
}

/** Delivers one client edit through the object's real socket handler. */
async function clientEdit(name: string): Promise<void> {
    const client = new Y.Doc();
    let update: Uint8Array = new Uint8Array();
    client.on('update', (u: Uint8Array) => { update = u; });
    seedResultsDoc(client, [{ findingKey: 'client:added:key' }]);
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, 0);
    syncProtocol.writeUpdate(enc, update);
    const pair = new WebSocketPair();
    const server = pair[1];
    server.accept();
    const frame = encoding.toUint8Array(enc);
    const message = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength);
    await runInDurableObject(stub(name), async (instance) => { await instance.webSocketMessage(server, message); });
    await runDurableObjectAlarm(stub(name));
    await new Promise<void>((resolve) => setTimeout(resolve, 1300));
}

/** One fixed source document: every build mints new client ids, so comparing bytes needs the same bytes. */
const SOURCE_YDOC = bytesToBase64(Y.encodeStateAsUpdate(builtDoc()));

const sourcePayload = (over: object = {}) => JSON.stringify({
    ydoc: SOURCE_YDOC,
    identity: { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT },
    snapshots: [],
    ...over,
});

const importInto = (name: string, payload: string) => stub(name).fetch('https://do.test/state-import', { method: 'POST', body: payload });

describe('the derived-from-d1 marker', () => {
    beforeAll(seedDatabase);
    beforeEach(seedDatabase);

    it('is set when the document was built from the database and nothing else has touched it', async () => {
        await openFromDatabase('derived-1');
        const out = await exported('derived-1');
        expect(out.ydoc).not.toBeNull();
        expect(out.derivedFromD1).toBe(true);
    });

    it('is cleared for good by the first client edit', async () => {
        await openFromDatabase('derived-2');
        expect((await exported('derived-2')).derivedFromD1).toBe(true);
        await clientEdit('derived-2');
        expect((await exported('derived-2')).derivedFromD1).toBe(false);
    });

    it('is not set on an object that already had a stored document', async () => {
        // A document handed over by an import is stored state: opening it later must not mark it as database-built.
        expect((await importInto('derived-3', sourcePayload())).status).toBe(200);
        await openFromDatabase('derived-3');
        expect((await exported('derived-3')).derivedFromD1).toBe(false);
    });
});

describe('replacing a derived target', () => {
    beforeAll(seedDatabase);
    beforeEach(seedDatabase);

    it('replaces an unedited, database-built target, audits both sides, and the object then serves the source', async () => {
        await openFromDatabase('replace-1');
        const before = await exported('replace-1');
        expect(before.derivedFromD1).toBe(true);

        const res = await importInto('replace-1', sourcePayload({ replaceDerived: true, snapshots: [{ seq: 1, atMs: 1, byUserId: null, reason: 'manual', projection: {} }] }));
        expect(res.status).toBe(200);
        const body = (await res.json()) as { replaced: { previousBytes: number; previousSha256: string; newSha256: string } | null };
        expect(body.replaced?.previousSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(body.replaced?.previousBytes).toBeGreaterThan(0);

        const after = await exported('replace-1');
        expect(after.ydoc).toBe(SOURCE_YDOC);
        expect(after.derivedFromD1).toBe(false);
        expect(after.snapshots).toHaveLength(1);

        // Idempotent: a second run finds a target that is no longer derived.
        const again = await importInto('replace-1', sourcePayload({ replaceDerived: true }));
        expect(again.status).toBe(409);
        expect(await again.json()).toMatchObject({ reason: 'target-edited' });
    });

    it('refuses a target a client has edited, and keeps it', async () => {
        await openFromDatabase('replace-2');
        await clientEdit('replace-2');
        const res = await importInto('replace-2', sourcePayload({ replaceDerived: true }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ reason: 'target-edited' });
    });

    it('refuses a target built for a different document', async () => {
        await openFromDatabase('replace-3');
        const res = await importInto('replace-3', sourcePayload({ replaceDerived: true, identity: { tenantId: TENANT, inspectionId: INSPECTION, reportId: 'r-other' } }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ reason: 'target-identity-mismatch' });
    });

    it('without the flag the same derived target is a plain refusal', async () => {
        await openFromDatabase('replace-4');
        const res = await importInto('replace-4', sourcePayload());
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ reason: 'target-has-state' });
    });
});

describe('undoing a replacement, and a target that was never saved', () => {
    beforeAll(seedDatabase);
    beforeEach(seedDatabase);

    it('puts the displaced document back, marks it database-built again, and the backup is spent', async () => {
        await openFromDatabase('undo-1');
        const displaced = (await exported('undo-1')).ydoc;
        expect((await importInto('undo-1', sourcePayload({ replaceDerived: true }))).status).toBe(200);

        const restored = await stub('undo-1').fetch('https://do.test/state-restore-backup', { method: 'POST' });
        expect(restored.status).toBe(200);
        const after = await exported('undo-1');
        expect(after.ydoc).toBe(displaced);
        expect(after.derivedFromD1).toBe(true);
        expect((await stub('undo-1').fetch('https://do.test/state-restore-backup', { method: 'POST' })).status).toBe(404);
    });

    it('answers target-unsaved when the identity and marker are stored but the document never was', async () => {
        await runInDurableObject(stub('unsaved-1'), async (_i, state) => {
            await state.storage.put({ identity: { tenantId: TENANT, inspectionId: INSPECTION, reportId: REPORT }, 'derived-from-d1': true });
        });
        const res = await importInto('unsaved-1', sourcePayload({ replaceDerived: true }));
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ reason: 'target-unsaved' });
    });
});

describe('a restore after the replacement was edited', () => {
    beforeAll(seedDatabase);
    beforeEach(seedDatabase);

    it('is refused as target-edited once a client edit has persisted and disconnected, and changes nothing', async () => {
        await openFromDatabase('undo-edited');
        expect((await importInto('undo-edited', sourcePayload({ replaceDerived: true }))).status).toBe(200);
        await clientEdit('undo-edited');
        const before = await exported('undo-edited');

        const res = await stub('undo-edited').fetch('https://do.test/state-restore-backup', { method: 'POST' });
        expect(res.status).toBe(409);
        expect(await res.json()).toMatchObject({ error: 'target-edited' });
        const after = await exported('undo-edited');
        expect(after.ydoc).toBe(before.ydoc);
        const info = await stub('undo-edited').fetch('https://do.test/state-backup');
        expect(info.status).toBe(200);
    });
});
