// @vitest-environment happy-dom
/**
 * Unit tests for app/lib/collab/results-doc-connection.ts
 *
 * Uses fake-indexeddb (wired in tests/unit/setup-client.ts) and a minimal
 * WebSocket stub to drive the connection without a real server.
 *
 * Frame helpers are ported from tests/workers/collab-multiclient.spec.ts.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
    buildCollabWsUrl,
    connectResultsDoc,
    deleteResultsDb,
    reconnectDelayMs,
} from '../../../app/lib/collab/results-doc-connection';
import {
    seedResultsDoc,
    applyItemPatch,
} from '../../../server/lib/collab/results-doc';

// ─── Frame helpers (ported from collab-multiclient.spec.ts) ──────────────────

/** Framing prefix byte for y-protocols/sync messages (mirrors the DO constant). */
const MSG_SYNC = 0;

/** Framing byte for the restore control frame (mirrors the DO MSG_RESTORE). */
const MSG_RESTORE = 2;

/** Encode a bare MSG_RESTORE control frame (one varint byte, no body). */
function encodeRestore(): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_RESTORE);
    return encoding.toUint8Array(enc);
}

/** Encode a framed sync step1 request from `doc`. */
function encodeSyncStep1(doc: Y.Doc): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep1(enc, doc);
    return encoding.toUint8Array(enc);
}

/**
 * Encode a framed step2 from `serverDoc` answering `clientStateVector`.
 * Pass an empty Uint8Array to send the full state (no prior shared state).
 */
function encodeSyncStep2(serverDoc: Y.Doc, clientStateVector: Uint8Array): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeSyncStep2(enc, serverDoc, clientStateVector);
    return encoding.toUint8Array(enc);
}

/** Encode a framed update message carrying `update`. */
function encodeUpdate(update: Uint8Array): Uint8Array {
    const enc = encoding.createEncoder();
    encoding.writeVarUint(enc, MSG_SYNC);
    syncProtocol.writeUpdate(enc, update);
    return encoding.toUint8Array(enc);
}

// ─── WebSocket stub ───────────────────────────────────────────────────────────

/**
 * Minimal WebSocket stub. Records all sent frames and allows tests to push
 * inbound frames via pushInbound(). Fires listeners registered via
 * addEventListener so the connection code sees the same event API.
 */
class StubWebSocket extends EventTarget {
    static readonly CONNECTING = 0 as const;
    static readonly OPEN       = 1 as const;
    static readonly CLOSING    = 2 as const;
    static readonly CLOSED     = 3 as const;

    readonly CONNECTING = 0 as const;
    readonly OPEN       = 1 as const;
    readonly CLOSING    = 2 as const;
    readonly CLOSED     = 3 as const;

    readyState: number = StubWebSocket.OPEN;
    binaryType: string = 'arraybuffer';

    /** Every frame the connection code sent to the "server". */
    readonly sent: Uint8Array[] = [];

    /** Callbacks registered via addEventListener for quick test access. */
    readonly listeners: Map<string, EventListenerOrEventListenerObject[]> = new Map();

    private readonly url: string;

    constructor(url: string) {
        super();
        this.url = url;
        // Schedule the open event on the next microtask so connection code can
        // set up its listeners before the open fires.
        Promise.resolve().then(() => {
            this.dispatchEvent(new Event('open'));
        }).catch(() => { /* ignore */ });
    }

    override addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
        super.addEventListener(type, listener);
        const list = this.listeners.get(type) ?? [];
        list.push(listener);
        this.listeners.set(type, list);
    }

    send(data: ArrayBuffer | ArrayBufferView | string): void {
        if (typeof data === 'string') return;
        if (data instanceof ArrayBuffer) {
            this.sent.push(new Uint8Array(data));
        } else {
            // ArrayBufferView (Uint8Array, etc.)
            const view = data as ArrayBufferView;
            this.sent.push(new Uint8Array(view.buffer, view.byteOffset, view.byteLength));
        }
    }

    close(): void {
        this.readyState = StubWebSocket.CLOSED;
        this.dispatchEvent(new Event('close'));
    }

    /** Push a binary frame as if it arrived from the server. */
    pushInbound(frame: Uint8Array): void {
        const buf = frame.buffer.slice(frame.byteOffset, frame.byteOffset + frame.byteLength) as ArrayBuffer;
        const ev = new MessageEvent('message', { data: buf });
        this.dispatchEvent(ev);
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Flush pending microtasks and macrotasks to let fake-indexeddb resolve. */
async function flushAsync(ticks = 5): Promise<void> {
    for (let i = 0; i < ticks; i++) {
        await new Promise<void>((r) => setTimeout(r, 0));
    }
}

/** Collect frames of a given sync message type from the sent queue. */
function collectSyncMessages(sent: Uint8Array[]): number[] {
    return sent.map((frame) => {
        if (frame.length === 0) return -1;
        const dec = decoding.createDecoder(frame);
        const msgByte = decoding.readVarUint(dec);
        if (msgByte !== MSG_SYNC) return -1;
        return decoding.readVarUint(dec); // 0=step1, 1=step2, 2=update
    });
}

/** Decode the client state vector carried by a MSG_SYNC step1 frame. */
function readStep1StateVector(frame: Uint8Array): Uint8Array {
    const dec = decoding.createDecoder(frame);
    decoding.readVarUint(dec); // outer MSG_SYNC byte
    decoding.readVarUint(dec); // inner step1 type byte (0)
    return decoding.readVarUint8Array(dec);
}

/** Find the last MSG_SYNC step1 frame in the sent queue (newest wins). */
function lastStep1Frame(sent: Uint8Array[]): Uint8Array | undefined {
    for (let i = sent.length - 1; i >= 0; i--) {
        const frame = sent[i];
        const dec = decoding.createDecoder(frame);
        if (decoding.readVarUint(dec) !== MSG_SYNC) continue;
        if (decoding.readVarUint(dec) === syncProtocol.messageYjsSyncStep1) return frame;
    }
    return undefined;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

let stubSocket: StubWebSocket;

const testLoc = { protocol: 'https:', host: 'test.host' };

function makeWsImpl(): typeof WebSocket {
    return StubWebSocket as unknown as typeof WebSocket;
}

/**
 * Create a fresh StubWebSocket factory that captures the last instance.
 * Each call to the constructor updates `stubSocket`.
 */
function makeCapturingImpl(): typeof WebSocket {
    class CapturingStub extends StubWebSocket {
        constructor(url: string) {
            super(url);
            stubSocket = this;
        }
    }
    return CapturingStub as unknown as typeof WebSocket;
}

beforeEach(() => {
    // Reset stubSocket before each test.
    stubSocket = undefined as unknown as StubWebSocket;
});

// ── Test 1: buildCollabWsUrl ──────────────────────────────────────────────────

describe('buildCollabWsUrl', () => {
    it('returns wss:// for https: and encodes the id', () => {
        const url = buildCollabWsUrl('insp-123', { protocol: 'https:', host: 'example.com' });
        expect(url).toBe('wss://example.com/api/inspections/insp-123/collab/ws');
    });

    it('returns ws:// for http:', () => {
        const url = buildCollabWsUrl('insp-abc', { protocol: 'http:', host: 'localhost:8788' });
        expect(url).toBe('ws://localhost:8788/api/inspections/insp-abc/collab/ws');
    });

    it('percent-encodes ids containing special characters', () => {
        const id = 'insp/with spaces&more';
        const url = buildCollabWsUrl(id, { protocol: 'https:', host: 'example.com' });
        expect(url).toContain(encodeURIComponent(id));
        // Verify the path is correct
        expect(url).toBe(`wss://example.com/api/inspections/${encodeURIComponent(id)}/collab/ws`);
    });
});

// ── Test 2: Step1 is sent on open (after persistence synced) ─────────────────

describe('connectResultsDoc — step1 on open', () => {
    it('sends a MSG_SYNC step1 frame after persistence synced and socket opens', async () => {
        const id = `test-step1-${Date.now()}`;
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });

        // Wait for fake-indexeddb to resolve the synced event and the socket
        // open microtask to fire.
        await flushAsync(10);

        expect(stubSocket).toBeDefined();
        expect(stubSocket.sent.length).toBeGreaterThan(0);

        // First sent frame must be a MSG_SYNC step1 (inner type = 0).
        const syncTypes = collectSyncMessages(stubSocket.sent);
        expect(syncTypes).toContain(syncProtocol.messageYjsSyncStep1); // 0

        // The handle should have persistenceSynced flipped.
        expect(handle.persistenceSynced).toBe(true);

        destroy();
    });
});

// ── Test 3: Inbound step2 flips synced + data arrives ────────────────────────

describe('connectResultsDoc — inbound step2', () => {
    it('flips handle.synced and applies remote data after receiving a step2', async () => {
        const id = `test-step2-${Date.now()}`;
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });

        await flushAsync(10);
        expect(stubSocket).toBeDefined();

        // Build a remote doc with data.
        const remoteDoc = new Y.Doc();
        seedResultsDoc(remoteDoc, [{ findingKey: '_default:s1:i1' }]);
        applyItemPatch(remoteDoc, '_default:s1:i1', 'rating', 'NI');

        // Encode a step2 from remoteDoc (full state).
        // We encode the step2 as: encodeStateAsUpdate gives us the update,
        // which we wrap as an update message (type 2 in y-protocols/sync).
        // A real step2 is reply to our step1; the simplest way is to build it
        // by reading our step1 frame and building the reply.
        const ourStep1Frame = stubSocket.sent.find((f) => {
            const dec = decoding.createDecoder(f);
            const bt = decoding.readVarUint(dec);
            return bt === MSG_SYNC && decoding.readVarUint(dec) === syncProtocol.messageYjsSyncStep1;
        });
        expect(ourStep1Frame).toBeDefined();

        // Extract client state vector from the step1 frame:
        // frame layout: [MSG_SYNC=0, innerType=0, stateVectorBytes...]
        const step1Dec = decoding.createDecoder(ourStep1Frame!);
        decoding.readVarUint(step1Dec); // consume outer MSG_SYNC byte
        decoding.readVarUint(step1Dec); // consume inner sync step1 type byte (0)
        const clientSv = decoding.readVarUint8Array(step1Dec); // the state vector

        // Build a step2 answer from remoteDoc using the client's state vector.
        const step2Frame = encodeSyncStep2(remoteDoc, clientSv);

        // Push the step2 inbound.
        stubSocket.pushInbound(step2Frame);

        await flushAsync(3);

        expect(handle.synced).toBe(true);

        // The remote data must now be present in the local doc.
        const results = handle.doc.getMap('results');
        const item = results.get('_default:s1:i1') as Y.Map<unknown> | undefined;
        expect(item).toBeDefined();
        expect(item?.get('rating')).toBe('NI');

        destroy();
    });
});

// ── Test 4: Local update is forwarded framed ──────────────────────────────────

describe('connectResultsDoc — local update forwarding', () => {
    it('sends a MSG_SYNC update frame when the local doc is mutated', async () => {
        const id = `test-forward-${Date.now()}`;
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });

        await flushAsync(10);
        expect(stubSocket).toBeDefined();

        // Clear the initial step1 from the sent queue.
        const countBefore = stubSocket.sent.length;

        // Mutate the local doc — this should trigger the update forwarder.
        seedResultsDoc(handle.doc, [{ findingKey: '_default:s1:i2' }]);
        applyItemPatch(handle.doc, '_default:s1:i2', 'notes', 'local note');

        await flushAsync(3);

        // At least one new frame should have been sent.
        expect(stubSocket.sent.length).toBeGreaterThan(countBefore);

        // The new frame(s) must be MSG_SYNC update messages (inner type = 2).
        const newFrames = stubSocket.sent.slice(countBefore);
        const syncTypes = collectSyncMessages(newFrames);
        expect(syncTypes).toContain(syncProtocol.messageYjsUpdate); // 2

        destroy();
    });
});

// ── Test 5: Reload survives via IndexedDB ────────────────────────────────────

describe('connectResultsDoc — IndexedDB persistence', () => {
    it('restores prior data from IndexedDB after destroy + reconnect', async () => {
        const id = `test-persist-${Date.now()}`;

        // First connection: write data.
        const { handle: h1, destroy: d1 } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });
        await flushAsync(10);

        seedResultsDoc(h1.doc, [{ findingKey: '_default:s1:i3' }]);
        applyItemPatch(h1.doc, '_default:s1:i3', 'rating', 'IN');

        // Wait for IndexedDB to persist (fake-indexeddb is synchronous under
        // the hood but resolves through microtasks).
        await flushAsync(20);

        d1();

        // Second connection: same id, new doc — should see stored data.
        const { handle: h2, destroy: d2 } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });

        // Wait for persistence to restore.
        await flushAsync(20);

        expect(h2.persistenceSynced).toBe(true);

        const results = h2.doc.getMap('results');
        const item = results.get('_default:s1:i3') as Y.Map<unknown> | undefined;
        expect(item).toBeDefined();
        expect(item?.get('rating')).toBe('IN');

        d2();
    });
});

// ── Test 6: SSR guard ────────────────────────────────────────────────────────

describe('buildCollabWsUrl — safe without window (SSR guard)', () => {
    it('can build a URL without requiring a live window.location', () => {
        // buildCollabWsUrl is the only part of the module safe to call without a
        // real browser environment. This verifies it takes an explicit loc arg and
        // does not reach for window.location.
        const url = buildCollabWsUrl('insp-ssr', { protocol: 'https:', host: 'ssr.host' });
        expect(url).toBe('wss://ssr.host/api/inspections/insp-ssr/collab/ws');
    });
});

// ── Test 7: MSG_RESTORE converges a live client (drop + resync) ────────────────
//
// This is the whole point of Task 12b. A live client holds the post-restore
// (V2) edit. Because Yjs updates are additive (union), a plain MSG_SYNC update
// of the restored (V1) state would MERGE — leaving V2 in place. The MSG_RESTORE
// control frame instead drops local state + IndexedDB and resyncs the empty doc,
// so the step2 reply (full V1 state) applies with NO V2 contamination.

describe('connectResultsDoc — MSG_RESTORE drop+resync convergence', () => {
    it('converges to the restored V1 state, discarding the local V2 edit', async () => {
        const id = `test-restore-${Date.now()}`;
        const onChangeDocs: Y.Doc[] = [];
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
            onChange: (h) => { onChangeDocs.push(h.doc); },
        });

        await flushAsync(10);
        expect(stubSocket).toBeDefined();

        // ── 1. Drive an inbound step2 so the local doc holds i1 rating 'NI' (V1).
        const remoteV1 = new Y.Doc();
        seedResultsDoc(remoteV1, [{ findingKey: '_default:s1:i1' }]);
        applyItemPatch(remoteV1, '_default:s1:i1', 'rating', 'NI');

        const initialStep1 = lastStep1Frame(stubSocket.sent);
        expect(initialStep1).toBeDefined();
        stubSocket.pushInbound(encodeSyncStep2(remoteV1, readStep1StateVector(initialStep1!)));
        await flushAsync(3);

        const originalDoc = handle.doc;
        let item = originalDoc.getMap('results').get('_default:s1:i1') as Y.Map<unknown> | undefined;
        expect(item?.get('rating')).toBe('NI');

        // ── 1b. Locally mutate to 'RR' (V2) — local doc + IndexedDB now hold V2.
        applyItemPatch(handle.doc, '_default:s1:i1', 'rating', 'RR');
        await flushAsync(20); // let IndexedDB persist the V2 state
        item = handle.doc.getMap('results').get('_default:s1:i1') as Y.Map<unknown>;
        expect(item?.get('rating')).toBe('RR');

        const sentBeforeRestore = stubSocket.sent.length;

        // ── 2. Push a MSG_RESTORE control frame; flush async (DB delete + rebuild).
        stubSocket.pushInbound(encodeRestore());
        await flushAsync(25);

        // ── 3a. The rebuilt doc is a NEW Y.Doc instance.
        expect(handle.doc).not.toBe(originalDoc);
        expect(onChangeDocs).toContain(handle.doc);

        // ── 3b. A fresh step1 was sent AFTER the restore signal.
        const sentAfterRestore = stubSocket.sent.slice(sentBeforeRestore);
        const typesAfter = collectSyncMessages(sentAfterRestore);
        expect(typesAfter).toContain(syncProtocol.messageYjsSyncStep1); // 0

        // The fresh doc is empty before the resync answers (no leftover items).
        expect(handle.doc.getMap('results').size).toBe(0);
        expect(handle.synced).toBe(false);

        // ── 4. Push a step2 carrying the restored V1 state answering the new step1.
        const freshStep1 = lastStep1Frame(sentAfterRestore);
        expect(freshStep1).toBeDefined();
        stubSocket.pushInbound(encodeSyncStep2(remoteV1, readStep1StateVector(freshStep1!)));
        await flushAsync(3);

        // ── The local doc shows V1 ('NI') and NOT the locally-edited V2 ('RR').
        // If the code had done an additive apply, 'RR' would have survived.
        const restored = handle.doc.getMap('results').get('_default:s1:i1') as Y.Map<unknown> | undefined;
        expect(restored?.get('rating')).toBe('NI');
        expect(handle.synced).toBe(true);

        destroy();
    });

    it('is the discriminator: a plain MSG_SYNC update of V1 leaves V2 in place', async () => {
        // Contrast case — proves the additive-merge failure mode the control frame
        // fixes. WITHOUT a restore drop, broadcasting V1 as a normal update merges
        // (union), so the locally-edited V2 rating still wins. This is exactly why
        // the additive broadcast was replaced by MSG_RESTORE.
        const id = `test-additive-${Date.now()}`;
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });

        await flushAsync(10);
        expect(stubSocket).toBeDefined();

        // Local doc holds i1 'NI' (V1) via step2.
        const remoteV1 = new Y.Doc();
        seedResultsDoc(remoteV1, [{ findingKey: '_default:s1:i1' }]);
        applyItemPatch(remoteV1, '_default:s1:i1', 'rating', 'NI');
        const step1 = lastStep1Frame(stubSocket.sent);
        stubSocket.pushInbound(encodeSyncStep2(remoteV1, readStep1StateVector(step1!)));
        await flushAsync(3);

        // Locally mutate to 'RR' (V2).
        applyItemPatch(handle.doc, '_default:s1:i1', 'rating', 'RR');
        await flushAsync(3);

        // Now the "server" broadcasts the restored V1 state as a PLAIN update
        // (the additive path). encodeStateAsUpdate(remoteV1) is V1's full state.
        stubSocket.pushInbound(encodeUpdate(Y.encodeStateAsUpdate(remoteV1)));
        await flushAsync(3);

        // Additive merge: the local edit (V2 'RR', a later clock) survives.
        const item = handle.doc.getMap('results').get('_default:s1:i1') as Y.Map<unknown> | undefined;
        expect(item?.get('rating')).toBe('RR'); // NOT reverted — the failure mode

        destroy();
    });
});

// ── Test: reconnectDelayMs exponential backoff with cap ───────────────────────

describe('reconnectDelayMs', () => {
    it('doubles each attempt and caps at 30s', () => {
        expect(reconnectDelayMs(0)).toBe(400);
        expect(reconnectDelayMs(1)).toBe(800);
        expect(reconnectDelayMs(2)).toBe(1600);
        expect(reconnectDelayMs(3)).toBe(3200);
        expect(reconnectDelayMs(4)).toBe(6400);
        expect(reconnectDelayMs(5)).toBe(12800);
        expect(reconnectDelayMs(6)).toBe(25600);
        // 51200 would exceed the cap → clamped to 30000.
        expect(reconnectDelayMs(7)).toBe(30000);
        expect(reconnectDelayMs(20)).toBe(30000);
    });

    it('first retry is fast (400ms) then doubles', () => {
        expect(reconnectDelayMs(0)).toBe(400);
        expect(reconnectDelayMs(1)).toBe(800);
        expect(reconnectDelayMs(2)).toBe(1600);
    });

    it('caps at 30000ms', () => {
        expect(reconnectDelayMs(20)).toBe(30000);
    });
});

// ── Test: a socket close schedules a reopen after the backoff delay ────────────
//
// Count the StubWebSocket constructions: the initial connect makes one; an
// unexpected close should schedule a reopen that constructs a SECOND socket once
// the backoff timer fires. We drive the timer with vitest fake timers (installed
// only AFTER the initial real-timer sync so fake-indexeddb is not starved).

describe('connectResultsDoc — auto-reconnect on close', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reopens the socket (new construction) after the backoff delay', async () => {
        let constructions = 0;
        class CountingStub extends StubWebSocket {
            constructor(url: string) {
                super(url);
                constructions += 1;
                stubSocket = this;
            }
        }
        const id = `test-reconnect-${Date.now()}`;
        const { destroy } = connectResultsDoc(id, {
            WebSocketImpl: CountingStub as unknown as typeof WebSocket,
            location: testLoc,
        });

        await flushAsync(10);
        expect(constructions).toBe(1);
        const first = stubSocket;

        // Switch to fake timers, then close the socket → schedules a reopen.
        vi.useFakeTimers();
        first.close();

        // Before the backoff elapses, no new socket exists.
        expect(constructions).toBe(1);

        // Advance past the first backoff (1s) → the reopen timer fires.
        vi.advanceTimersByTime(1000);
        expect(constructions).toBe(2);
        expect(stubSocket).not.toBe(first);

        vi.useRealTimers();
        destroy();
    });

    it('does not reconnect after destroy()', async () => {
        let constructions = 0;
        class CountingStub extends StubWebSocket {
            constructor(url: string) {
                super(url);
                constructions += 1;
                stubSocket = this;
            }
        }
        const id = `test-noreconnect-${Date.now()}`;
        const { destroy } = connectResultsDoc(id, {
            WebSocketImpl: CountingStub as unknown as typeof WebSocket,
            location: testLoc,
        });
        await flushAsync(10);
        expect(constructions).toBe(1);

        vi.useFakeTimers();
        destroy(); // closes the socket; the close handler must NOT schedule a reopen
        vi.advanceTimersByTime(5000);
        expect(constructions).toBe(1);
        vi.useRealTimers();
    });
});

// ── Test: window 'online' reopens immediately + resets backoff ─────────────────

describe('connectResultsDoc — window online event', () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it('reopens immediately on the online event after a close', async () => {
        let constructions = 0;
        class CountingStub extends StubWebSocket {
            constructor(url: string) {
                super(url);
                constructions += 1;
                stubSocket = this;
            }
        }
        const id = `test-online-${Date.now()}`;
        const { destroy } = connectResultsDoc(id, {
            WebSocketImpl: CountingStub as unknown as typeof WebSocket,
            location: testLoc,
        });
        await flushAsync(10);
        expect(constructions).toBe(1);
        const first = stubSocket;

        vi.useFakeTimers();
        first.close(); // schedules a delayed reopen
        expect(constructions).toBe(1);

        // The online event reopens NOW (cancelling the pending delayed reopen).
        window.dispatchEvent(new Event('online'));
        expect(constructions).toBe(2);
        const second = stubSocket;
        expect(second).not.toBe(first);

        // The previously-scheduled delayed reopen must NOT fire a third socket
        // (online cleared the timer + a live socket exists).
        vi.advanceTimersByTime(5000);
        expect(constructions).toBe(2);

        vi.useRealTimers();
        destroy();
    });
});

// ── Test: onSynced fires on the initial connect AND on each reconnect ──────────

describe('connectResultsDoc — onSynced trigger', () => {
    it('fires onSynced on every step2 (initial + reconnect)', async () => {
        let syncedCalls = 0;
        const id = `test-onsynced-${Date.now()}`;
        const { handle, destroy } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
            onSynced: () => { syncedCalls += 1; },
        });

        await flushAsync(10);
        expect(stubSocket).toBeDefined();

        // Initial step2 → onSynced #1.
        const remote = new Y.Doc();
        seedResultsDoc(remote, [{ findingKey: '_default:s1:i1' }]);
        applyItemPatch(remote, '_default:s1:i1', 'rating', 'NI');
        const step1a = lastStep1Frame(stubSocket.sent);
        stubSocket.pushInbound(encodeSyncStep2(remote, readStep1StateVector(step1a!)));
        await flushAsync(3);
        expect(handle.synced).toBe(true);
        expect(syncedCalls).toBe(1);

        // Close + reconnect with real timers (short-circuit via window online).
        const first = stubSocket;
        first.close();
        window.dispatchEvent(new Event('online')); // reopen immediately
        await flushAsync(5);
        expect(stubSocket).not.toBe(first);

        // Second step2 on the reconnected socket → onSynced #2 (handle.synced
        // stays true; the trigger still fires).
        const step1b = lastStep1Frame(stubSocket.sent);
        stubSocket.pushInbound(encodeSyncStep2(remote, readStep1StateVector(step1b!)));
        await flushAsync(3);
        expect(syncedCalls).toBe(2);

        destroy();
    });
});

// ── Test 8: deleteResultsDb resolves and clears stored state ───────────────────

describe('deleteResultsDb', () => {
    it('clears persisted state so a later connection starts empty', async () => {
        const id = `test-deldb-${Date.now()}`;

        // First connection: write data and persist to IndexedDB.
        const { handle: h1, destroy: d1 } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });
        await flushAsync(10);
        seedResultsDoc(h1.doc, [{ findingKey: '_default:s1:i9' }]);
        applyItemPatch(h1.doc, '_default:s1:i9', 'rating', 'IN');
        await flushAsync(20);
        d1();

        // Delete the database (the restore-path cleanup helper).
        await deleteResultsDb(id);
        await flushAsync(5);

        // Reconnect with the same id — the store is gone, so no data restores.
        const { handle: h2, destroy: d2 } = connectResultsDoc(id, {
            WebSocketImpl: makeCapturingImpl(),
            location: testLoc,
        });
        await flushAsync(20);
        expect(h2.persistenceSynced).toBe(true);
        expect(h2.doc.getMap('results').size).toBe(0);

        d2();
    });
});
