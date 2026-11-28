/**
 * Contract tests for the host-injected persistence + socket URL on
 * `connectResultsDoc`. They use a fake persistence and a fake WebSocket and no
 * browser globals, so they also prove the module runs without a DOM.
 */
import { describe, it, expect, vi } from 'vitest';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
    connectResultsDoc,
    resultsDocName,
    type DiscardedCopyNotice,
    type ResultsDocPersistence,
} from './results-doc-connection';
import type { DiscardedStoreInfo, ResultsDocLineageFactory } from './results-doc-lineage';

const MSG_SYNC = 0;
const MSG_RESTORE = 2;
const MSG_GENERATION = 4;

class FakeSocket extends EventTarget {
    static instances: FakeSocket[] = [];
    readonly OPEN = 1 as const;
    readonly CONNECTING = 0 as const;
    readyState = 1;
    binaryType = 'blob';
    readonly sent: Uint8Array[] = [];
    readonly url: string;
    constructor(url: string) {
        super();
        this.url = url;
        FakeSocket.instances.push(this);
        void Promise.resolve().then(() => this.dispatchEvent(new Event('open')));
    }
    send(data: Uint8Array): void { this.sent.push(data); }
    close(): void { this.readyState = 3; }
    /** The server ends the socket with a close code, the way the results document does for a published report. */
    closeFromServer(code: number): void {
        this.readyState = 3;
        this.dispatchEvent(Object.assign(new Event('close'), { code }));
    }
    push(frame: Uint8Array): void {
        const buf = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
        this.dispatchEvent(new MessageEvent('message', { data: buf }));
    }
}

const WS = FakeSocket as unknown as typeof WebSocket;

function restoreFrame(): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_RESTORE);
    return encoding.toUint8Array(enc);
}

/** The server's first frame: the generation byte + the history id as a varstring. */
function generationFrame(gen: string): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_GENERATION);
    encoding.writeVarString(enc, gen);
    return encoding.toUint8Array(enc);
}

/** A fake lineage store: one recorded generation + the backup slot it was asked to write. */
function makeLineage(initial: string | null, failSave = false): { factory: ResultsDocLineageFactory; saved: Array<{ update: Uint8Array; info: DiscardedStoreInfo }> } {
    let gen = initial;
    const saved: Array<{ update: Uint8Array; info: DiscardedStoreInfo }> = [];
    const factory: ResultsDocLineageFactory = () => ({
        read: async () => gen,
        write: async (g: string) => { gen = g; },
        saveDiscarded: async (update: Uint8Array, info: DiscardedStoreInfo) => {
            if (failSave) throw new Error('backup slot unavailable');
            saved.push({ update, info });
        },
    });
    return { factory, saved };
}

/** Two findings in the local doc, under composite keys. */
function seedFindings(doc: Y.Doc): void {
    const results = doc.getMap('results');
    doc.transact(() => {
        const a = new Y.Map();
        a.set('rating', 'NI');
        results.set('unit-1:sec-1:item-1', a);
        const b = new Y.Map();
        b.set('rating', 'D');
        results.set('unit-1:sec-1:item-2', b);
    });
}

async function connectedWithFindings(opts: { lineage?: ReturnType<typeof makeLineage> } = {}): Promise<{
    handle: ReturnType<typeof connectResultsDoc>['handle'];
    destroy: () => void;
    socket: FakeSocket;
    notices: DiscardedCopyNotice[];
    saved: Array<{ update: Uint8Array; info: DiscardedStoreInfo }>;
}> {
    FakeSocket.instances = [];
    const host = makeHost();
    const notices: DiscardedCopyNotice[] = [];
    const conn = connectResultsDoc('insp-478', {
        WebSocketImpl: WS,
        persistence: host.persistence,
        wsUrl: host.wsUrl,
        ...(opts.lineage ? { lineage: opts.lineage.factory } : {}),
        onDiscarded: (n) => notices.push(n),
    });
    host.release();
    await tick();
    seedFindings(conn.handle.doc);
    await tick();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('socket was not opened');
    return { ...conn, socket, notices, saved: opts.lineage?.saved ?? [] };
}

function step1Count(sent: Uint8Array[]): number {
    return sent.filter((f) => {
        const dec = decoding.createDecoder(f);
        return decoding.readVarUint(dec) === MSG_SYNC && decoding.readVarUint(dec) === 0;
    }).length;
}

async function tick(n = 5): Promise<void> {
    for (let i = 0; i < n; i++) await new Promise<void>((r) => setTimeout(r, 0));
}

function makeHost() {
    let release: () => void = () => {};
    const stores: Array<ResultsDocPersistence & { name: string; doc: Y.Doc }> = [];
    const destroy = vi.fn(async () => {});
    const clearData = vi.fn(async () => {});
    let first = true;
    const persistence = (name: string, doc: Y.Doc) => {
        // Only the FIRST store is gated; a rebuilt store (after restore) settles at once.
        const whenSynced: Promise<unknown> = first
            ? new Promise<void>((resolve) => { release = resolve; })
            : Promise.resolve();
        first = false;
        const store = { name, doc, whenSynced, destroy, clearData };
        stores.push(store);
        return store;
    };
    const wsUrl = vi.fn((id: string) => `wss://host.test/collab/${id}`);
    return { persistence, wsUrl, stores, destroy, clearData, release: () => release() };
}

describe('connectResultsDoc host contract', () => {
    it('opens no socket until the persistence has synced, then opens exactly one', async () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const { handle, destroy } = connectResultsDoc('insp-1', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
        });
        await tick();
        // Negative: persistence still pending.
        expect(FakeSocket.instances).toHaveLength(0);
        expect(handle.persistenceSynced).toBe(false);

        host.release();
        await tick();
        // Positive control: same code path, now released.
        expect(FakeSocket.instances).toHaveLength(1);
        expect(handle.persistenceSynced).toBe(true);
        destroy();
    });

    it('names the store results-<id> and takes the socket URL from wsUrl', async () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const { destroy } = connectResultsDoc('insp/odd id', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
        });
        host.release();
        await tick();
        expect(host.stores[0]?.name).toBe('results-insp/odd id');
        expect(resultsDocName('x')).toBe('results-x');
        expect(host.wsUrl).toHaveBeenCalledWith('insp/odd id', null);
        expect(FakeSocket.instances[0]?.url).toBe('wss://host.test/collab/insp/odd id');
        destroy();
    });

    it('on MSG_RESTORE destroys then clears the store once, rebuilds it, and resyncs with a new step1', async () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const { handle, destroy } = connectResultsDoc('insp-2', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
        });
        host.release();
        await tick();
        const socket = FakeSocket.instances[0];
        if (!socket) throw new Error('socket was not opened');
        const firstDoc = handle.doc;
        expect(step1Count(socket.sent)).toBe(1);
        expect(host.clearData).not.toHaveBeenCalled();

        socket.push(restoreFrame());
        await tick(10);

        expect(host.destroy).toHaveBeenCalledTimes(1);
        expect(host.clearData).toHaveBeenCalledTimes(1);
        expect(host.stores).toHaveLength(2);
        expect(host.stores[1]?.doc).toBe(handle.doc);
        expect(handle.doc).not.toBe(firstDoc);
        expect(step1Count(socket.sent)).toBe(2);
        // No second socket: the resync rides the still-open one.
        expect(FakeSocket.instances).toHaveLength(1);
        destroy();
    });

    it('a persistence without clearData still restores (clearData is optional)', async () => {
        FakeSocket.instances = [];
        const destroyStore = vi.fn(async () => {});
        const { handle, destroy } = connectResultsDoc('insp-3', {
            WebSocketImpl: WS,
            persistence: () => ({ whenSynced: Promise.resolve(), destroy: destroyStore }),
            wsUrl: (id) => `wss://h/${id}`,
        });
        await tick();
        const before = handle.doc;
        const socket = FakeSocket.instances[0];
        if (!socket) throw new Error('socket was not opened');
        socket.push(restoreFrame());
        await tick(10);
        expect(handle.doc).not.toBe(before);
        destroy();
    });

    it('destroy() destroys the persistence', async () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const { destroy } = connectResultsDoc('insp-4', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
        });
        host.release();
        await tick();
        expect(host.destroy).not.toHaveBeenCalled();
        destroy();
        destroy(); // idempotent
        expect(host.destroy).toHaveBeenCalledTimes(1);
    });

    it('subscribeOnline is wired and unsubscribed on destroy', () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const unsubscribe = vi.fn();
        const subscribeOnline = vi.fn((_cb: () => void) => unsubscribe);
        const { destroy } = connectResultsDoc('insp-5', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
            subscribeOnline,
        });
        expect(subscribeOnline).toHaveBeenCalledTimes(1);
        expect(unsubscribe).not.toHaveBeenCalled();
        destroy();
        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
});
describe('a report that is published', () => {
    async function connected() {
        FakeSocket.instances = [];
        vi.useFakeTimers();
        const host = makeHost();
        let online: () => void = () => undefined;
        const changes: boolean[] = [];
        const conn = connectResultsDoc('insp-lock', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
            subscribeOnline: (cb) => { online = cb; return () => undefined; },
            onChange: (h) => changes.push(h.locked === true),
        });
        host.release();
        await vi.advanceTimersByTimeAsync(10);
        expect(FakeSocket.instances).toHaveLength(1);
        return { ...conn, online: () => online(), changes };
    }

    it('stops reconnecting when the socket is closed with 4409, and says it is locked', async () => {
        const { handle, destroy, online, changes } = await connected();
        FakeSocket.instances[0]!.closeFromServer(4409);
        await vi.advanceTimersByTimeAsync(120_000);
        online();                                            // even a "network is back" signal does not reopen it
        await vi.advanceTimersByTimeAsync(120_000);
        expect(FakeSocket.instances).toHaveLength(1);
        expect(handle.locked).toBe(true);
        expect(changes.at(-1)).toBe(true);
        destroy();
        vi.useRealTimers();
    });

    it('(control) any other close still reconnects', async () => {
        const { handle, destroy } = await connected();
        FakeSocket.instances[0]!.closeFromServer(1006);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(FakeSocket.instances.length).toBeGreaterThan(1);
        expect(handle.locked).toBeUndefined();
        destroy();
        vi.useRealTimers();
    });
});


describe('a discarded local copy (#478)', () => {
    it('a lineage mismatch discards, backs up, and names what was lost', async () => {
        const lin = makeLineage('gen-old-0001');
        const { handle, destroy, socket, notices, saved } = await connectedWithFindings({ lineage: lin });
        const firstDoc = handle.doc;

        socket.push(generationFrame('gen-new-0002'));
        await tick(10);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ kind: 'lineage', itemCount: 2, backedUp: true });
        expect(typeof notices[0]?.atMs).toBe('number');
        expect(handle.discarded).toEqual(notices[0]);
        // The backup slot holds the discarded copy: it round-trips with both findings.
        expect(saved).toHaveLength(1);
        expect(saved[0]?.info).toEqual({ storedGen: 'gen-old-0001', serverGen: 'gen-new-0002' });
        const copy = new Y.Doc();
        Y.applyUpdate(copy, saved[0]?.update ?? new Uint8Array());
        expect(copy.getMap('results').size).toBe(2);
        // The doc was rebuilt and the resync re-pulled on the same socket.
        // Exactly one step1: the pre-judgement one is held back until the
        // generation frame is judged, so only the post-discard step1 goes out.
        expect(handle.doc).not.toBe(firstDoc);
        expect(step1Count(socket.sent)).toBe(1);
        destroy();
    });

    it('a version restore backs the local copy up too, and says so', async () => {
        const lin = makeLineage('gen-aaaaaaa1');
        const { handle, destroy, socket, notices, saved } = await connectedWithFindings({ lineage: lin });

        socket.push(restoreFrame());
        await tick(10);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ kind: 'restore', itemCount: 2, backedUp: true });
        expect(handle.discarded).toEqual(notices[0]);
        expect(saved).toHaveLength(1);
        expect(saved[0]?.info.storedGen).toBe('gen-aaaaaaa1');
        expect(handle.doc.getMap('results').size).toBe(0);
        destroy();
    });

    it('a restore of an empty local copy still reports, with nothing backed up', async () => {
        FakeSocket.instances = [];
        const host = makeHost();
        const notices: DiscardedCopyNotice[] = [];
        const { handle, destroy } = connectResultsDoc('insp-478-empty', {
            WebSocketImpl: WS,
            persistence: host.persistence,
            wsUrl: host.wsUrl,
            onDiscarded: (n) => notices.push(n),
        });
        host.release();
        await tick();
        const socket = FakeSocket.instances[0];
        if (!socket) throw new Error('socket was not opened');

        socket.push(restoreFrame());
        await tick(10);

        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ kind: 'restore', itemCount: 0, backedUp: false });
        destroy();
    });

    it('a restore whose backup fails still resyncs, and the notice says no backup was kept', async () => {
        const lin = makeLineage('gen-aaaaaaa1', true);
        const { handle, destroy, socket, notices, saved } = await connectedWithFindings({ lineage: lin });
        const firstDoc = handle.doc;

        socket.push(restoreFrame());
        await tick(10);

        expect(saved).toHaveLength(0);
        expect(notices).toHaveLength(1);
        expect(notices[0]).toMatchObject({ kind: 'restore', itemCount: 2, backedUp: false });
        // No veto on the restore path: the doc was rebuilt and the resync went ahead.
        expect(handle.doc).not.toBe(firstDoc);
        expect(handle.lineageHold).not.toBe(true);
        destroy();
    });

    it('(control) a lineage discard whose backup fails keeps the copy and reports no discard', async () => {
        const lin = makeLineage('gen-old-0001', true);
        const { handle, destroy, socket, notices } = await connectedWithFindings({ lineage: lin });
        const firstDoc = handle.doc;

        socket.push(generationFrame('gen-new-0002'));
        await tick(10);

        expect(notices).toHaveLength(0);
        expect(handle.discarded).toBeUndefined();
        expect(handle.lineageHold).toBe(true);
        expect(handle.doc).toBe(firstDoc);
        destroy();
    });
});
