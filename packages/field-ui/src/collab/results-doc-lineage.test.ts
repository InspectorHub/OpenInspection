/**
 * The lineage guard on `connectResultsDoc`: a client whose offline store belongs to another history than the server's
 * must discard it, never hand it back (see `results-doc-lineage.ts`). Fake persistence, fake lineage store, fake socket,
 * no browser globals.
 */
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
    connectResultsDoc,
    type ConnectOptions,
    type ResultsDocHandle,
    type ResultsDocPersistence,
} from './results-doc-connection';
import type { ResultsDocLineageStore } from './results-doc-lineage';
import { appendPhoto, loadResultsProjection, projectResults, seedResultsDoc } from '../shared/results-doc';

const MSG_SYNC = 0;
const MSG_RESTORE = 2;
const MSG_GENERATION = 4;
const photo = (key: string) => ({ key, mediaType: 'image' }) as never;

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

const settle = async (): Promise<void> => { for (let i = 0; i < 6; i++) await new Promise<void>((r) => setTimeout(r, 0)); };

function genFrame(gen: string): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_GENERATION);
    encoding.writeVarString(enc, gen);
    return encoding.toUint8Array(enc);
}
function restoreFrame(gen?: string): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_RESTORE);
    if (gen !== undefined) encoding.writeVarString(enc, gen);
    return encoding.toUint8Array(enc);
}
function step1From(doc: Y.Doc): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    return encoding.toUint8Array(enc);
}

/** Everything the client sent, applied to a scratch document: what the server would end up holding from it. */
function whatServerReceived(sent: Uint8Array[]): Y.Doc {
    const scratch = new Y.Doc();
    for (const f of sent) {
        const dec = decoding.createDecoder(f);
        if (decoding.readVarUint(dec) !== MSG_SYNC) continue;
        syncProtocol.readSyncMessage(dec, encoding.createEncoder(), scratch, null);
    }
    return scratch;
}
const photoKeys = (d: Y.Doc): string[] => (projectResults(d).kitchen?.photos ?? []).map((p) => p.key);

/** An offline store from before the server's history was rebuilt. */
function staleStoreBytes(): Uint8Array {
    const d = new Y.Doc();
    seedResultsDoc(d, [{ findingKey: 'kitchen' }]);
    appendPhoto(d, 'kitchen', photo('STALE1'));
    appendPhoto(d, 'kitchen', photo('STALE2'));
    return Y.encodeStateAsUpdate(d);
}

interface World {
    stored: { bytes: Uint8Array | null };
    lineage: { gen: string | null; failBackup: boolean; backupGate: Promise<void> | null; onClear: (() => void) | null; writes: string[]; discarded: Array<{ update: Uint8Array; storedGen: string; serverGen: string }> };
    opts: ConnectOptions;
    cleared: () => number;
}

function world(init: { bytes: Uint8Array | null; gen: string | null }, withLineage = true): World {
    FakeSocket.instances = [];
    const stored = { bytes: init.bytes };
    let clears = 0;
    const lineage: World['lineage'] = { gen: init.gen, failBackup: false, backupGate: null, onClear: null, writes: [], discarded: [] };
    const store: ResultsDocLineageStore = {
        read: async () => lineage.gen,
        write: async (g) => { lineage.gen = g; lineage.writes.push(g); },
        saveDiscarded: async (update, info) => { if (lineage.failBackup) throw new Error('disk full'); await lineage.backupGate; lineage.discarded.push({ update, ...info }); },
    };
    const persistence = (_name: string, doc: Y.Doc): ResultsDocPersistence => {
        if (stored.bytes) Y.applyUpdate(doc, stored.bytes);
        doc.on('update', () => { stored.bytes = Y.encodeStateAsUpdate(doc); });
        return {
            whenSynced: Promise.resolve(),
            destroy: () => undefined,
            clearData: async () => { clears += 1; lineage.onClear?.(); stored.bytes = null; },
        };
    };
    return {
        stored, lineage, cleared: () => clears,
        opts: { persistence, wsUrl: (_id, gen) => 'wss://x/collab' + (gen ? `?gen=${gen}` : ''), WebSocketImpl: WS, ...(withLineage ? { lineage: () => store } : {}) },
    };
}

async function connected(w: World): Promise<{ handle: ResultsDocHandle; socket: FakeSocket; destroy: () => void }> {
    const { handle, destroy } = connectResultsDoc('insp-1', w.opts);
    await settle();
    const socket = FakeSocket.instances[0];
    if (!socket) throw new Error('no socket opened');
    return { handle, socket, destroy };
}

describe('lineage guard: a stale offline store is never handed back', () => {
    it('discards the local store when the server generation differs, and never sends its content', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        // The server's own step1 follows the generation frame at once.
        const server = new Y.Doc();
        loadResultsProjection(server, { kitchen: { photos: [photo('K1'), photo('A5')] } } as never);
        socket.push(step1From(server));
        await settle();

        expect(photoKeys(handle.doc)).toEqual([]);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual([]);
        expect(w.cleared()).toBe(1);
        expect(w.lineage.gen).toBe('gen-new-0002');
        destroy();
    });

    it('keeps a one-slot copy of what it discarded, naming both generations', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        await settle();

        expect(w.lineage.discarded).toHaveLength(1);
        const kept = w.lineage.discarded[0];
        expect(kept?.storedGen).toBe('gen-old-0001');
        expect(kept?.serverGen).toBe('gen-new-0002');
        const copy = new Y.Doc();
        Y.applyUpdate(copy, kept?.update ?? new Uint8Array());
        expect(photoKeys(copy)).toEqual(['STALE1', 'STALE2']);
        destroy();
    });

    it('re-pulls the server state after discarding (a fresh step1 on the open socket)', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        const before = socket.sent.length;
        socket.push(genFrame('gen-new-0002'));
        await settle();
        const after = socket.sent.slice(before).map((f) => {
            const dec = decoding.createDecoder(f);
            return [decoding.readVarUint(dec), decoding.readVarUint(dec)];
        });
        expect(after).toContainEqual([MSG_SYNC, syncProtocol.messageYjsSyncStep1]);
        destroy();
    });

    it('keeps the store and hands it back when the generation is the same', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-same-001'));
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(photoKeys(handle.doc)).toEqual(['STALE1', 'STALE2']);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2']);
        expect(w.cleared()).toBe(0);
        expect(w.lineage.discarded).toHaveLength(0);
        destroy();
    });

    it('adopts the server generation for a legacy store that never recorded one (and keeps its data)', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: null });
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(w.lineage.gen).toBe('gen-new-0002');
        expect(w.cleared()).toBe(0);
        expect(photoKeys(handle.doc)).toEqual(['STALE1', 'STALE2']);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2']);
        destroy();
    });

    it('does not back up an empty store (nothing to protect)', async () => {
        const w = world({ bytes: null, gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        await settle();
        expect(w.lineage.discarded).toHaveLength(0);
        expect(w.lineage.gen).toBe('gen-new-0002');
        destroy();
    });
});

describe('lineage guard: frame order and compatibility', () => {
    it('holds back local edits made before the generation frame, then delivers them when the lineage matches', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { handle, socket, destroy } = await connected(w);
        const sentBefore = socket.sent.length;
        appendPhoto(handle.doc, 'kitchen', photo('EDIT1'));
        expect(socket.sent.length).toBe(sentBefore); // not forwarded: the lineage is not checked yet
        socket.push(genFrame('gen-same-001'));
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2', 'EDIT1']);
        destroy();
    });

    it('never sends local state to a server that holds another lineage, even for edits made before the frame', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { handle, socket, destroy } = await connected(w);
        appendPhoto(handle.doc, 'kitchen', photo('EDIT1'));
        socket.push(genFrame('gen-new-0002'));
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual([]);
        destroy();
    });

    it('still syncs against an old server that never sends a generation frame', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { handle, socket, destroy } = await connected(w);
        socket.push(step1From(new Y.Doc())); // the first frame is sync: an old server
        await settle();
        expect(w.cleared()).toBe(0);
        expect(w.lineage.writes).toEqual([]);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2']);
        appendPhoto(handle.doc, 'kitchen', photo('EDIT1'));
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2', 'EDIT1']);
        destroy();
    });

    it('checks the lineage again on every reconnect', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-same-001'));
        await settle();
        // The server was rebuilt while this tab slept: the next socket announces another generation.
        socket.readyState = 3;
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }));
        await new Promise<void>((r) => setTimeout(r, 600));
        const next = FakeSocket.instances[1];
        if (!next) throw new Error('no reconnect');
        next.push(genFrame('gen-new-0002'));
        await settle();
        expect(w.cleared()).toBe(1);
        expect(w.lineage.gen).toBe('gen-new-0002');
        destroy();
    });

    it('ignores an unknown frame type from a future server', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { handle, socket, destroy } = await connected(w);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, 9);
        encoding.writeVarString(enc, 'future');
        socket.push(encoding.toUint8Array(enc));
        await settle();
        expect(photoKeys(handle.doc)).toEqual(['STALE1', 'STALE2']);
        destroy();
    });

    it('works unchanged when the host supplies no lineage store (older hosts, tests)', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: null }, false);
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(photoKeys(handle.doc)).toEqual(['STALE1', 'STALE2']);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual(['STALE1', 'STALE2']);
        destroy();
    });
});

describe('lineage guard: restore frames', () => {
    it('records the generation a restore frame carries and does not back up (a deliberate restore)', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-old-0001'));
        await settle();
        socket.push(restoreFrame('gen-restored-3'));
        await settle();
        expect(w.cleared()).toBe(1);
        expect(w.lineage.gen).toBe('gen-restored-3');
        expect(w.lineage.discarded).toHaveLength(0);
        destroy();
    });

    it('a restore frame without a body (older server) still restores and leaves the stored generation alone', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        socket.push(restoreFrame());
        await settle();
        expect(w.cleared()).toBe(1);
        expect(w.lineage.gen).toBe('gen-old-0001');
        destroy();
    });
});

/** The state vector a step 1 frame carries. */
function step1Vector(frame: Uint8Array): Uint8Array | null {
    const dec = decoding.createDecoder(frame);
    if (decoding.readVarUint(dec) !== MSG_SYNC || decoding.readVarUint(dec) !== syncProtocol.messageYjsSyncStep1) return null;
    return decoding.readVarUint8Array(dec);
}
const step1Frames = (sent: Uint8Array[]): Uint8Array[] => sent.filter((f) => step1Vector(f) !== null);

describe('lineage guard: no step 1 before the lineage is judged', () => {
    it('holds the open-time step 1 back, then sends it once the generation matches', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { socket, destroy } = await connected(w);
        expect(step1Frames(socket.sent)).toHaveLength(0);
        socket.push(genFrame('gen-same-001'));
        await settle();
        expect(step1Frames(socket.sent)).toHaveLength(1);
        destroy();
    });

    it('after a discard the only step 1 on the socket is the fresh one (an empty state vector), never a stale one', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        // A sync frame that arrives while the discard is still under way is dropped, and cannot flip `synced`.
        const server = new Y.Doc();
        loadResultsProjection(server, { kitchen: { photos: [photo('K1')] } } as never);
        const enc = encoding.createEncoder();
        encoding.writeVarUint(enc, MSG_SYNC);
        syncProtocol.writeSyncStep2(enc, server, new Uint8Array([0]));
        socket.push(encoding.toUint8Array(enc));
        expect(handle.synced).toBe(false);
        await settle();
        expect(handle.synced).toBe(false);
        const vectors = step1Frames(socket.sent).map((f) => step1Vector(f)?.length);
        expect(vectors).toEqual([1]); // a state vector of an empty document is one byte
        destroy();
    });

    it('sends the step 1 when an old server speaks sync first', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { socket, destroy } = await connected(w);
        socket.push(step1From(new Y.Doc()));
        await settle();
        expect(step1Frames(socket.sent)).toHaveLength(1);
        destroy();
    });
});

describe('lineage guard: the in-memory document decides, not the shared record (two tabs)', () => {
    /** This tab is in sync with `gen-same-001`; then another tab discards, records `gen-new-0002` and clears the store; this tab's socket drops. */
    async function tabBAfterTabADiscarded(): Promise<{ w: World; next: FakeSocket; destroy: () => void }> {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { socket, destroy } = await connected(w);
        expect(socket.url).toBe('wss://x/collab?gen=gen-same-001');
        socket.push(genFrame('gen-same-001'));
        await settle();
        w.lineage.gen = 'gen-new-0002'; // tab A: discarded, wrote the new id, cleared the shared IndexedDB
        w.stored.bytes = null;
        socket.readyState = 3;
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }));
        await new Promise<void>((r) => setTimeout(r, 600));
        const next = FakeSocket.instances[1];
        if (!next) throw new Error('no reconnect');
        return { w, next, destroy };
    }

    it('reconnects naming the generation of its own document, and never hands the old history to the new lineage', async () => {
        const { w, next, destroy } = await tabBAfterTabADiscarded();
        expect(next.url).toBe('wss://x/collab?gen=gen-same-001'); // not the recorded gen-new-0002
        next.push(genFrame('gen-new-0002'));
        const server = new Y.Doc();
        loadResultsProjection(server, { kitchen: { photos: [photo('K1')] } } as never);
        next.push(step1From(server));
        await settle();
        expect(photoKeys(whatServerReceived(next.sent))).toEqual([]);
        expect(w.lineage.discarded[0]?.storedGen).toBe('gen-same-001');
        expect(w.lineage.gen).toBe('gen-new-0002');
        const copy = new Y.Doc();
        Y.applyUpdate(copy, w.lineage.discarded[0]?.update ?? new Uint8Array());
        expect(photoKeys(copy)).toEqual(['STALE1', 'STALE2']); // the history went to the backup slot
        destroy();
    });

    it('control: when the server still holds this document history, the reconnect keeps it and answers the server', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-same-001' });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-same-001'));
        await settle();
        socket.readyState = 3;
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }));
        await new Promise<void>((r) => setTimeout(r, 600));
        const next = FakeSocket.instances[1];
        if (!next) throw new Error('no reconnect');
        expect(next.url).toBe('wss://x/collab?gen=gen-same-001');
        next.push(genFrame('gen-same-001'));
        next.push(step1From(new Y.Doc()));
        await settle();
        expect(w.cleared()).toBe(0);
        expect(photoKeys(whatServerReceived(next.sent))).toEqual(['STALE1', 'STALE2']);
        destroy();
    });

    it('a document that belongs to no recorded history is discarded when the record now holds one, not trusted', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: null });
        const { socket, destroy } = await connected(w);
        expect(socket.url).toBe('wss://x/collab'); // nothing recorded: no parameter
        socket.readyState = 3;
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006 })); // dropped before any frame was judged
        w.lineage.gen = 'gen-new-0002';
        await new Promise<void>((r) => setTimeout(r, 600));
        const next = FakeSocket.instances[1];
        if (!next) throw new Error('no reconnect');
        next.push(genFrame('gen-new-0002'));
        next.push(step1From(new Y.Doc()));
        await settle();
        expect(w.cleared()).toBe(1);
        expect(photoKeys(whatServerReceived(next.sent))).toEqual([]);
        destroy();
    });
});

describe('lineage guard: a backup that cannot be written abandons the discard', () => {
    it('keeps the store, writes no new generation, sends nothing, flags the hold and retries on the next open', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        w.lineage.failBackup = true;
        const { handle, socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        socket.push(step1From(new Y.Doc())); // the server's step 1 right behind: must not be answered
        await settle();
        expect(w.cleared()).toBe(0);
        expect(w.lineage.gen).toBe('gen-old-0001');
        expect(photoKeys(handle.doc)).toEqual(['STALE1', 'STALE2']);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual([]);
        expect(handle.lineageHold).toBe(true);

        // The next open retries; with the disk working it discards and clears the hold.
        w.lineage.failBackup = false;
        await new Promise<void>((r) => setTimeout(r, 600));
        const next = FakeSocket.instances[1];
        if (!next) throw new Error('no retry');
        next.push(genFrame('gen-new-0002'));
        await settle();
        expect(w.cleared()).toBe(1);
        expect(w.lineage.gen).toBe('gen-new-0002');
        expect(w.lineage.discarded).toHaveLength(1);
        expect(handle.lineageHold).toBe(false);
        destroy();
    });
});

describe('lineage guard: a socket that drops mid-discard, and edits typed during it', () => {
    it('reconnects after a drop that happens while the backup is being written (the close handler ignores it)', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        let release: () => void = () => undefined;
        w.lineage.backupGate = new Promise<void>((r) => { release = r; });
        const { socket, destroy } = await connected(w);
        socket.push(genFrame('gen-new-0002'));
        await settle();
        socket.readyState = 3;
        socket.dispatchEvent(Object.assign(new Event('close'), { code: 1006 }));
        release();
        await new Promise<void>((r) => setTimeout(r, 700));
        expect(FakeSocket.instances.length).toBeGreaterThan(1);
        destroy();
    });

    it('an edit typed while the backup is pending is not forwarded and is in the final backup', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        let release: () => void = () => undefined;
        w.lineage.backupGate = new Promise<void>((r) => { release = r; });
        const { handle, socket, destroy } = await connected(w);
        const staleDoc = handle.doc;
        socket.push(genFrame('gen-new-0002'));
        await settle();
        appendPhoto(staleDoc, 'kitchen', photo('LATE1'));
        release();
        await settle();
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual([]);
        const last = w.lineage.discarded.at(-1);
        const copy = new Y.Doc();
        Y.applyUpdate(copy, last?.update ?? new Uint8Array());
        expect(photoKeys(copy)).toEqual(['STALE1', 'STALE2', 'LATE1']);
        destroy();
    });

    it('an edit typed while the store is being cleared is added to the backup, not silently dropped', async () => {
        const w = world({ bytes: staleStoreBytes(), gen: 'gen-old-0001' });
        const { handle, socket, destroy } = await connected(w);
        const staleDoc = handle.doc;
        w.lineage.onClear = () => appendPhoto(staleDoc, 'kitchen', photo('LATE2'));
        socket.push(genFrame('gen-new-0002'));
        await settle();
        const last = w.lineage.discarded.at(-1);
        const copy = new Y.Doc();
        Y.applyUpdate(copy, last?.update ?? new Uint8Array());
        expect(photoKeys(copy)).toEqual(['STALE1', 'STALE2', 'LATE2']);
        expect(photoKeys(whatServerReceived(socket.sent))).toEqual([]);
        destroy();
    });
});
