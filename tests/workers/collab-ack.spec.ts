/**
 * Collab ACK frame (MSG_ACK = 3), workerd runtime.
 *
 * The Durable Object sends a snapshot (state vector + delete set) of its document
 * to the sockets that opted in, AFTER the storage write succeeded. Sockets that did
 * not opt in never see the frame. Driven through runInDurableObject with a
 * MockWebSocket (the pool cannot upgrade a socket across DOs), plus one test that
 * calls the DO's own fetch() so a REAL WebSocketPair and the real hibernation tag
 * are exercised.
 *
 * Every negative assertion has a positive control in the same test.
 */

import { env, runInDurableObject } from 'cloudflare:test';
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { INSPECTION_RESULTS_TEST_DDL } from '../helpers/inline-ddl';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { seedResultsDoc, applyItemPatch } from '@core/field-ui/shared/results-doc';
import { logger } from '../../server/lib/logger';
import type { InspectionDocDO } from '../../server/durable-objects/inspection-doc';

interface TestBindings { DB: D1Database; INSPECTION_DOC: DurableObjectNamespace<InspectionDocDO> }
const b = env as unknown as TestBindings;

const MSG_SYNC = 0;
const MSG_ACK = 3;
const KEY = '_default:sec1:item1';

interface DOInternals {
    doc: Y.Doc;
    ctx: { storage: { put: (...args: unknown[]) => Promise<void> } };
    persist(): Promise<void>;
    ackTargets(): WebSocket[];
    restoreSnapshot(seq: number, byUserId: string | null): Promise<{ ok: boolean }>;
    captureSnapshot(byUserId: string | null): Promise<{ seq: number }>;
    webSocketMessage(ws: WebSocket, data: ArrayBuffer): Promise<void>;
}

class MockWebSocket {
    readonly sent: Uint8Array[] = [];
    send(data: ArrayBuffer | Uint8Array | string): void {
        if (typeof data === 'string') return;
        this.sent.push(data instanceof ArrayBuffer ? new Uint8Array(data) : data);
    }
    close(): void { /* no-op */ }
    asWs(): WebSocket { return this as unknown as WebSocket; }
    acks(): Uint8Array[] { return this.sent.filter((f) => f[0] === MSG_ACK); }
}

function updateFrame(update: Uint8Array): ArrayBuffer {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc).buffer as ArrayBuffer;
}

function decodeAck(frame: Uint8Array): Y.Snapshot {
    const dec = decoding.createDecoder(frame);
    expect(decoding.readVarUint(dec)).toBe(MSG_ACK);
    return Y.decodeSnapshot(decoding.readVarUint8Array(dec));
}

/** An update, made on a throwaway client doc, that sets `rating` on the seeded item. */
function clientEdit(rating: string, base?: Y.Doc): Uint8Array {
    const client = new Y.Doc();
    if (base) Y.applyUpdate(client, Y.encodeStateAsUpdate(base));
    const before = Y.encodeStateVector(client);
    applyItemPatch(client, KEY, 'rating', rating);
    return Y.encodeStateAsUpdate(client, before);
}

async function withDo(fn: (io: DOInternals, instance: InspectionDocDO) => Promise<void>): Promise<void> {
    const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`ack-tenant:insp-${crypto.randomUUID()}`));
    await runInDurableObject(stub, async (instance: InspectionDocDO) => {
        const io = instance as unknown as DOInternals;
        seedResultsDoc(io.doc, [{ findingKey: KEY }]);
        await fn(io, instance);
    });
}

/** Swap the DO's storage `put` for one the test controls; returns the restore function. */
function replacePut(io: DOInternals, put: (...args: unknown[]) => Promise<void>): () => void {
    const storage = io.ctx.storage;
    const original = storage.put.bind(storage);
    Object.defineProperty(storage, 'put', { value: put, configurable: true, writable: true });
    return () => { Object.defineProperty(storage, 'put', { value: original, configurable: true, writable: true }); };
}

afterEach(() => { vi.restoreAllMocks(); });

describe('collab ack frame', () => {
    beforeAll(async () => {
        await b.DB.exec(INSPECTION_RESULTS_TEST_DDL);
        await b.DB.exec('CREATE TABLE IF NOT EXISTS inspections (id TEXT PRIMARY KEY NOT NULL, tenant_id TEXT NOT NULL, template_snapshot TEXT);');
    });

    it('an opted-in socket gets exactly one ack that covers the edit; with no opted-in socket there are zero extra frames', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            const edit = clientEdit('NI', io.doc);
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(edit));

            io.ackTargets = () => [ws.asWs()];
            const snapshotSpy = vi.spyOn(Y, 'snapshot');
            await io.persist();
            // Positive control: the spy does see the snapshot taken inside the ack module.
            expect(snapshotSpy).toHaveBeenCalled();
            expect(ws.sent).toHaveLength(1);
            expect(ws.acks()).toHaveLength(1);
            expect(Y.snapshotContainsUpdate(decodeAck(ws.sent[0]!), edit)).toBe(true);

            // Control: a different update the document never received is not covered.
            const unseen = clientEdit('RR');
            expect(Y.snapshotContainsUpdate(decodeAck(ws.sent[0]!), unseen)).toBe(false);
        });
        vi.restoreAllMocks(); // the second half starts with a fresh spy

        await withDo(async (io, instance) => {
            const bystander = new MockWebSocket(); // connected but not opted in: never an ack target
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(clientEdit('NI', io.doc)));
            io.ackTargets = () => [];
            const encodeSpy = vi.spyOn(Y, 'snapshot');
            await io.persist();
            expect(bystander.sent).toHaveLength(0);
            // No opted-in socket: the snapshot is not even computed.
            expect(encodeSpy).not.toHaveBeenCalled();
        });
    });

    it('does not send before the storage write resolves, and sends after it does', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(clientEdit('NI', io.doc)));

            let release: () => void = () => { /* replaced below */ };
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const restore = replacePut(io, async () => { await gate; });
            try {
                const pending = io.persist();
                await new Promise((r) => setTimeout(r, 20));
                expect(ws.acks()).toHaveLength(0);
                release();
                await pending;
                expect(ws.acks()).toHaveLength(1);
            } finally { restore(); }
        });
    });

    it('the ack does not claim an update that arrived while the write was in flight', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            const u1 = clientEdit('NI', io.doc);
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(u1));

            let release: () => void = () => { /* replaced below */ };
            const gate = new Promise<void>((resolve) => { release = resolve; });
            const restore = replacePut(io, async () => { await gate; });
            let u2: Uint8Array;
            try {
                const pending = io.persist();
                u2 = clientEdit('RR', io.doc);
                await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(u2));
                release();
                await pending;
            } finally { restore(); }

            expect(ws.acks()).toHaveLength(1);
            const first = decodeAck(ws.acks()[0]!);
            expect(Y.snapshotContainsUpdate(first, u1)).toBe(true);
            expect(Y.snapshotContainsUpdate(first, u2)).toBe(false);

            // Control: the next persist does cover it.
            await io.persist();
            expect(ws.acks()).toHaveLength(2);
            expect(Y.snapshotContainsUpdate(decodeAck(ws.acks()[1]!), u2)).toBe(true);
        });
    });

    it('a failed storage write sends no ack and is logged; the next successful persist sends it', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            const errorSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
            const restore = replacePut(io, async () => { throw new Error('storage down'); });
            try {
                // The edit arms the debounce timer, whose persist() rejects: that rejection must be logged, not dropped.
                await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(clientEdit('NI', io.doc)));
                for (let i = 0; i < 60 && errorSpy.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 50));
                expect(errorSpy).toHaveBeenCalled();
                expect(ws.acks()).toHaveLength(0);
                await expect(io.persist()).rejects.toThrow('storage down');
                expect(ws.acks()).toHaveLength(0);
            } finally { restore(); }

            await io.persist();
            expect(ws.acks()).toHaveLength(1);
        });
    });

    it('does not repeat an ack for an unchanged document, and acks again after a change', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(clientEdit('NI', io.doc)));
            await io.persist();
            await io.persist();
            expect(ws.acks()).toHaveLength(1);
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(clientEdit('RR', io.doc)));
            await io.persist();
            expect(ws.acks()).toHaveLength(2);
        });
    });

    it('an inbound type-3 frame changes nothing and gets no reply', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            const before = Y.encodeStateAsUpdate(io.doc);
            const forged = encoding.createEncoder();
            encoding.writeVarUint(forged, MSG_ACK);
            encoding.writeVarUint8Array(forged, Y.encodeSnapshot(Y.snapshot(io.doc)));
            await instance.webSocketMessage(ws.asWs(), encoding.toUint8Array(forged).buffer as ArrayBuffer);
            expect(ws.sent).toHaveLength(0);
            expect(Y.encodeStateAsUpdate(io.doc)).toEqual(before);
            // Control: a real step1 on the same socket is answered.
            const step1 = encoding.createEncoder();
            encoding.writeVarUint(step1, MSG_SYNC);
            syncProtocol.writeSyncStep1(step1, io.doc);
            await instance.webSocketMessage(ws.asWs(), encoding.toUint8Array(step1).buffer as ArrayBuffer);
            expect(ws.sent).toHaveLength(1);
        });
    });

    it('skips an over-size snapshot with one warning; a small document is acked', async () => {
        await withDo(async (io) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
            const wide = new Y.Doc();
            const map = wide.getMap('wide');
            for (let i = 1; i <= 12000; i++) { wide.clientID = 1_000_000_000 + i; map.set('k' + i, i); }
            Y.applyUpdate(io.doc, Y.encodeStateAsUpdate(wide));
            await io.persist();
            expect(ws.acks()).toHaveLength(0);
            expect(warnSpy).toHaveBeenCalledTimes(1);
            await io.persist();
            expect(warnSpy).toHaveBeenCalledTimes(1);
        });
        await withDo(async (io) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            await io.persist();
            expect(ws.acks()).toHaveLength(1);
        });
    }, 30_000);

    it('after a restore the ack describes the restored document, not the one it replaced', async () => {
        await withDo(async (io, instance) => {
            const ws = new MockWebSocket();
            io.ackTargets = () => [ws.asWs()];
            const { seq } = await io.captureSnapshot(null);
            const lost = clientEdit('NI', io.doc);
            await instance.webSocketMessage(new MockWebSocket().asWs(), updateFrame(lost));
            await io.persist();
            expect(Y.snapshotContainsUpdate(decodeAck(ws.acks().at(-1)!), lost)).toBe(true);

            const acksBefore = ws.acks().length;
            await io.restoreSnapshot(seq, null);
            expect(ws.acks().length).toBeGreaterThan(acksBefore);
            expect(Y.snapshotContainsUpdate(decodeAck(ws.acks().at(-1)!), lost)).toBe(false);
        });
    });

    it('over a real WebSocket, only the socket that opted in (header) receives an ack; the other sees the same frames as before', async () => {
        const stub = b.INSPECTION_DOC.get(b.INSPECTION_DOC.idFromName(`ack-tenant:insp-${crypto.randomUUID()}`));
        await runInDurableObject(stub, async (instance: InspectionDocDO) => {
            const io = instance as unknown as DOInternals;
            seedResultsDoc(io.doc, [{ findingKey: KEY }]);

            async function open(optIn: boolean): Promise<{ frames: Uint8Array[]; ws: WebSocket }> {
                const headers: Record<string, string> = {
                    Upgrade: 'websocket', 'x-tenant-id': 'ack-tenant', 'x-inspection-id': 'insp-real', 'x-report-id': 'rep-real', 'x-user-id': 'u1',
                };
                if (optIn) headers['x-collab-ack'] = '1';
                const res = await instance.fetch(new Request('https://do.local/ws', { headers }));
                const ws = res.webSocket!;
                ws.binaryType = 'arraybuffer';
                ws.accept();
                const frames: Uint8Array[] = [];
                ws.addEventListener('message', (e) => { frames.push(new Uint8Array(e.data as ArrayBuffer)); });
                return { frames, ws };
            }
            const withAck = await open(true);
            const without = await open(false);
            await new Promise((r) => setTimeout(r, 50));
            // Both got the same first frame: sync step 1.
            expect(withAck.frames.map((f) => f[0])).toEqual([MSG_SYNC]);
            expect(without.frames.map((f) => f[0])).toEqual([MSG_SYNC]);

            io.doc.transact(() => { applyItemPatch(io.doc, KEY, 'rating', 'NI'); });
            await io.persist();
            await new Promise((r) => setTimeout(r, 100));
            expect(withAck.frames.filter((f) => f[0] === MSG_ACK)).toHaveLength(1);
            expect(without.frames.filter((f) => f[0] === MSG_ACK)).toHaveLength(0);
            expect(without.frames.map((f) => f[0])).not.toContain(MSG_ACK);
            withAck.ws.close(); without.ws.close();
        });
    });
});
