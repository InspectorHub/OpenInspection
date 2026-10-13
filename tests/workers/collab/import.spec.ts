/**
 * Offline import into the collaborative results document (workerd).
 *
 * `POST /import` on the Durable Object applies a Yjs update produced by a client
 * that worked offline. It must snapshot first, be safe to repeat, refuse what it
 * cannot undo, and never leave a half-applied document behind.
 *
 * The route in front of it (auth, tenant scoping, size limits) is covered by
 * tests/unit/collab/collab-import-route.spec.ts; this file drives the object the
 * way the route does, with the identity headers the route sets.
 *
 * Every refusal is paired with a positive control (the same call, minus the
 * fault, succeeds) so a harness that rejects everything cannot pass.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { INSPECTION_RESULTS_TEST_DDL } from '../../helpers/inline-ddl';
import { seedResultsDoc, applyItemPatch, projectResults } from '../../../server/lib/collab/results-doc';
import { MAX_IMPORT_BYTES } from '../../../server/durable-objects/inspection-doc-import';
import type { InspectionDocDO } from '../../../server/durable-objects/inspection-doc';
import type { ResultsProjection } from '../../../server/lib/collab/results-doc.types';

interface TestBindings {
    DB: D1Database;
    INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO>;
}
const b = env as unknown as TestBindings;

const TENANT = 'test-tenant-import';
const KEY = '_default:sec1:item1';

// ─── Harness ──────────────────────────────────────────────────────────────────

async function seedSchema(): Promise<void> {
    await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
    await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
}

async function clearTables(): Promise<void> {
    await b.DB.exec('DELETE FROM inspection_results;');
    await b.DB.exec('DELETE FROM inspections;');
}

/** The members of the object the tests reach into. */
interface DOInternals {
    doc: Y.Doc;
    tenantId: string | null;
    inspectionId: string | null;
    identityPersisted: boolean;
    persist(): Promise<void>;
    ctx: {
        storage: { put(key: string, value: unknown): Promise<void> };
        getWebSockets(): unknown[];
    };
    fetch(req: Request): Promise<Response>;
}

/** Captures every frame the object broadcasts. */
class MockWebSocket {
    readonly sent: Uint8Array[] = [];
    send(data: ArrayBuffer | Uint8Array | string): void {
        if (typeof data === 'string') return;
        this.sent.push(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    }
    close(): void { /* no-op */ }
}

function importRequest(inspectionId: string, body: Uint8Array): Request {
    return new Request('https://do.local/import', {
        method: 'POST',
        headers: {
            'x-tenant-id': TENANT,
            'x-inspection-id': inspectionId,
            'x-user-id': 'u-importer',
        },
        body: new Uint8Array(body),
    });
}

interface Fixture {
    inspectionId: string;
    stub: DurableObjectStub<InspectionDocDO>;
    /** What the server holds before any import: one item rated NI. */
    baseState: Uint8Array;
}

/** A document that already has content, as a server that has been edited online would. */
async function seededServer(): Promise<Fixture> {
    const inspectionId = 'insp-import-' + crypto.randomUUID().slice(0, 8);
    const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:${inspectionId}`));
    const baseState = await runInDurableObject(stub, (instance: InspectionDocDO) => {
        const io = instance as unknown as DOInternals;
        io.tenantId = TENANT;
        io.inspectionId = inspectionId;
        io.identityPersisted = true;
        seedResultsDoc(io.doc, [{ findingKey: KEY }]);
        applyItemPatch(io.doc, KEY, 'rating', 'NI');
        return Y.encodeStateAsUpdate(io.doc);
    });
    return { inspectionId, stub, baseState };
}

/**
 * What a device produces: it started from the server's state, then its
 * inspector worked offline. Returns the FULL state, which is what a bundle
 * carries.
 */
function offlineUpdate(baseState: Uint8Array, edit: (doc: Y.Doc) => void): Uint8Array {
    const device = new Y.Doc();
    Y.applyUpdate(device, baseState);
    edit(device);
    return Y.encodeStateAsUpdate(device);
}

const rate = (rating: string) => (doc: Y.Doc): void => { applyItemPatch(doc, KEY, 'rating', rating); };

async function liveProjection(stub: DurableObjectStub<InspectionDocDO>): Promise<ResultsProjection> {
    return runInDurableObject(stub, (instance: InspectionDocDO) =>
        projectResults((instance as unknown as DOInternals).doc));
}

async function liveState(stub: DurableObjectStub<InspectionDocDO>): Promise<Uint8Array> {
    return runInDurableObject(stub, (instance: InspectionDocDO) =>
        Y.encodeStateAsUpdate((instance as unknown as DOInternals).doc));
}

interface SnapshotMeta { seq: number; reason?: string; byUserId: string | null }

async function snapshotList(f: Fixture): Promise<SnapshotMeta[]> {
    const res = await f.stub.fetch('https://do.local/snapshots', {
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': f.inspectionId },
    });
    return (await res.json()) as SnapshotMeta[];
}

async function snapshotProjection(f: Fixture, seq: number): Promise<ResultsProjection> {
    const res = await f.stub.fetch(`https://do.local/snapshots/${seq}`, {
        headers: { 'x-tenant-id': TENANT, 'x-inspection-id': f.inspectionId },
    });
    return ((await res.json()) as { projection: ResultsProjection }).projection;
}

/** Decode a broadcast frame to its y-protocols sync message type, or null when it is not a sync frame. */
function syncMessageType(frame: Uint8Array): number | null {
    const decoder = decoding.createDecoder(frame);
    if (decoding.readVarUint(decoder) !== 0) return null;
    return decoding.readVarUint(decoder);
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('DO /import — apply an offline Yjs update behind a mandatory snapshot', () => {
    beforeAll(seedSchema);
    beforeEach(clearTables);

    it('snapshots the pre-import state (reason import), then applies the update', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));

        const res = await f.stub.fetch(importRequest(f.inspectionId, update));
        expect(res.status, await res.clone().text()).toBe(200);
        const out = (await res.json()) as { ok: boolean; snapshotSeq: number };
        expect(out.ok).toBe(true);

        const list = await snapshotList(f);
        const newest = list[0];
        expect(newest.reason).toBe('import');
        expect(newest.byUserId).toBe('u-importer');
        expect(newest.seq).toBe(out.snapshotSeq);

        // The snapshot is the state BEFORE the import; the live document has it.
        expect((await snapshotProjection(f, newest.seq))[KEY]?.rating).toBe('NI');
        expect((await liveProjection(f.stub))[KEY]?.rating).toBe('RR');
    });

    it('importing the same update twice leaves the document byte-for-byte as the first import did', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));

        expect((await f.stub.fetch(importRequest(f.inspectionId, update))).status).toBe(200);
        const projectionAfterFirst = await liveProjection(f.stub);
        const stateAfterFirst = await liveState(f.stub);

        const second = await f.stub.fetch(importRequest(f.inspectionId, update));
        expect(second.status, await second.clone().text()).toBe(200);

        expect(await liveProjection(f.stub)).toEqual(projectionAfterFirst);
        expect(await liveState(f.stub)).toEqual(stateAfterFirst);

        // Control: a DIFFERENT update does change the document, so the equality
        // above is evidence of idempotency and not of an import that does nothing.
        const other = offlineUpdate(f.baseState, rate('FI'));
        expect((await f.stub.fetch(importRequest(f.inspectionId, other))).status).toBe(200);
        expect(await liveState(f.stub)).not.toEqual(stateAfterFirst);
    });

    it('refuses with 503 and leaves the document untouched when the snapshot cannot be written', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));

        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            const before = projectResults(io.doc);
            const stateBefore = Y.encodeStateAsUpdate(io.doc);

            const storage = io.ctx.storage;
            const realPut = storage.put.bind(storage);
            storage.put = (key: string, value: unknown): Promise<void> =>
                key === 'snapshots' ? Promise.reject(new Error('storage unavailable')) : realPut(key, value);
            try {
                const refused = await io.fetch(importRequest(f.inspectionId, update));
                expect(refused.status).toBe(503);
            } finally {
                storage.put = realPut;
            }
            expect(projectResults(io.doc)).toEqual(before);
            expect(Y.encodeStateAsUpdate(io.doc)).toEqual(stateBefore);

            // Positive control: the same call with storage healthy succeeds.
            const accepted = await io.fetch(importRequest(f.inspectionId, update));
            expect(accepted.status, await accepted.clone().text()).toBe(200);
            expect(projectResults(io.doc)[KEY]?.rating).toBe('RR');
        });
    });

    it('broadcasts the imported change to a connected editor', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));

        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            const editor = new MockWebSocket();
            io.ctx.getWebSockets = () => [editor];

            expect(editor.sent).toHaveLength(0);
            const res = await io.fetch(importRequest(f.inspectionId, update));
            expect(res.status, await res.clone().text()).toBe(200);

            const frames = editor.sent.filter((fr) => syncMessageType(fr) === syncProtocol.messageYjsUpdate);
            expect(frames.length).toBeGreaterThan(0);

            // The frame is a usable update: applying it to the editor's own copy shows the rating.
            const editorDoc = new Y.Doc();
            Y.applyUpdate(editorDoc, f.baseState);
            for (const fr of frames) {
                const decoder = decoding.createDecoder(fr);
                decoding.readVarUint(decoder);
                syncProtocol.readSyncMessage(decoder, encoding.createEncoder(), editorDoc, null);
            }
            expect(projectResults(editorDoc)[KEY]?.rating).toBe('RR');
        });
    });

    // ── Malformed input ───────────────────────────────────────────────────────

    it('Y.applyUpdate is not atomic: a truncated update throws AFTER changing the document', async () => {
        // The premise the trial-apply rests on, pinned so a library change that made
        // it atomic (or worse) is noticed rather than assumed away.
        const f = await seededServer();
        const truncated = offlineUpdate(f.baseState, rate('RR')).slice(0, -1);
        const probe = new Y.Doc();
        Y.applyUpdate(probe, f.baseState);
        const before = Y.encodeStateAsUpdate(probe);
        expect(() => Y.applyUpdate(probe, truncated)).toThrow();
        expect(Y.encodeStateAsUpdate(probe)).not.toEqual(before);
    });

    it('answers 400 and leaves the document untouched for a truncated update; the whole one is accepted', async () => {
        const f = await seededServer();
        const whole = offlineUpdate(f.baseState, rate('RR'));
        const stateBefore = await liveState(f.stub);
        const snapshotsBefore = (await snapshotList(f)).length;

        const refused = await f.stub.fetch(importRequest(f.inspectionId, whole.slice(0, -1)));
        expect(refused.status).toBe(400);
        expect(await liveState(f.stub)).toEqual(stateBefore);
        expect((await liveProjection(f.stub))[KEY]?.rating).toBe('NI');
        // A bad update must not spend a snapshot slot.
        expect((await snapshotList(f)).length).toBe(snapshotsBefore);

        const accepted = await f.stub.fetch(importRequest(f.inspectionId, whole));
        expect(accepted.status).toBe(200);
        expect((await liveProjection(f.stub))[KEY]?.rating).toBe('RR');
    });

    it('answers 400 for bytes that are not a Yjs update at all', async () => {
        const f = await seededServer();
        const stateBefore = await liveState(f.stub);
        for (const junk of [Uint8Array.from([255, 255, 255, 255, 255]), Uint8Array.from([1, 2, 3])]) {
            const res = await f.stub.fetch(importRequest(f.inspectionId, junk));
            expect(res.status).toBe(400);
        }
        expect(await liveState(f.stub)).toEqual(stateBefore);
    });

    it('answers 400 for an empty body, and accepts a real update afterwards', async () => {
        const f = await seededServer();
        const res = await f.stub.fetch(importRequest(f.inspectionId, new Uint8Array(0)));
        expect(res.status).toBe(400);
        const ok = await f.stub.fetch(importRequest(f.inspectionId, offlineUpdate(f.baseState, rate('RR'))));
        expect(ok.status).toBe(200);
    });

    it('answers 422 and applies NOTHING for an update that builds on history this document lacks', async () => {
        // A delta against a state the server never had: Yjs would report success and
        // park the unreachable part. The client must hear that, not discard its copy.
        const f = await seededServer();
        const stranger = new Y.Doc();
        seedResultsDoc(stranger, [{ findingKey: KEY }]);
        const strangerBase = Y.encodeStateVector(stranger);
        applyItemPatch(stranger, KEY, 'rating', 'FI');
        const delta = Y.encodeStateAsUpdate(stranger, strangerBase);

        const stateBefore = await liveState(f.stub);
        const res = await f.stub.fetch(importRequest(f.inspectionId, delta));
        expect(res.status).toBe(422);
        expect(await liveState(f.stub)).toEqual(stateBefore);

        // Control: the same device's FULL state carries its history and is accepted.
        const full = await f.stub.fetch(importRequest(f.inspectionId, Y.encodeStateAsUpdate(stranger)));
        expect(full.status, await full.clone().text()).toBe(200);
    });

    // ── Size and identity ─────────────────────────────────────────────────────

    it('answers 413 above the size cap and does not touch the document; the cap itself is not refused for size', async () => {
        const f = await seededServer();
        const stateBefore = await liveState(f.stub);
        const tooBig = await f.stub.fetch(importRequest(f.inspectionId, new Uint8Array(MAX_IMPORT_BYTES + 1)));
        expect(tooBig.status).toBe(413);
        expect(await liveState(f.stub)).toEqual(stateBefore);

        // At the cap the size rule stays out of it (the bytes are junk, so 400 is the right answer).
        const atCap = await f.stub.fetch(importRequest(f.inspectionId, new Uint8Array(MAX_IMPORT_BYTES).fill(255)));
        expect(atCap.status).toBe(400);
    });

    it('answers 400 when the route supplied no identity, and the document is untouched', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));
        const stateBefore = await liveState(f.stub);
        // A fresh object that never learned its identity.
        const fresh = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`${TENANT}:anonymous-${crypto.randomUUID().slice(0, 8)}`));
        const res = await fresh.fetch('https://do.local/import', { method: 'POST', body: new Uint8Array(update) });
        expect(res.status).toBe(400);
        expect(await liveState(f.stub)).toEqual(stateBefore);
    });

    // ── Persistence ───────────────────────────────────────────────────────────

    it('answers 503 when persisting fails after the apply, and a retry is safe', async () => {
        const f = await seededServer();
        const update = offlineUpdate(f.baseState, rate('RR'));

        await runInDurableObject(f.stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            const realPersist = io.persist.bind(io);
            io.persist = () => Promise.reject(new Error('d1 unavailable'));
            let failed: Response;
            try {
                failed = await io.fetch(importRequest(f.inspectionId, update));
            } finally {
                io.persist = realPersist;
            }
            expect(failed.status).toBe(503);

            // The apply stands in memory (the debounced persist retries it), and a
            // client that retries is safe because the update is idempotent.
            const stateAfterFailure = Y.encodeStateAsUpdate(io.doc);
            const retry = await io.fetch(importRequest(f.inspectionId, update));
            expect(retry.status, await retry.clone().text()).toBe(200);
            expect(Y.encodeStateAsUpdate(io.doc)).toEqual(stateAfterFailure);
            expect(projectResults(io.doc)[KEY]?.rating).toBe('RR');
        });
    });
});
