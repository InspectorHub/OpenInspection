/**
 * Contract tests for the host-injected persistence + socket URL on
 * `connectResultsDoc`. They use a fake persistence and a fake WebSocket and no
 * browser globals, so they also prove the module runs without a DOM.
 */
import { describe, it, expect, vi } from 'vitest';
import type * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
    connectResultsDoc,
    resultsDocName,
    type ResultsDocPersistence,
} from './results-doc-connection';

const MSG_SYNC = 0;
const MSG_RESTORE = 2;

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
        expect(host.wsUrl).toHaveBeenCalledWith('insp/odd id');
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
