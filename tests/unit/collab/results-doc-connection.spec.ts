// @vitest-environment happy-dom
/**
 * Unit tests for app/lib/collab/results-doc-connection.ts
 *
 * Uses fake-indexeddb (wired in tests/unit/setup-client.ts) and a minimal
 * WebSocket stub to drive the connection without a real server.
 *
 * Frame helpers are ported from tests/workers/collab-multiclient.spec.ts.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import {
    buildCollabWsUrl,
    connectResultsDoc,
} from '../../../app/lib/collab/results-doc-connection';
import {
    seedResultsDoc,
    applyItemPatch,
} from '../../../server/lib/collab/results-doc';

// ─── Frame helpers (ported from collab-multiclient.spec.ts) ──────────────────

/** Framing prefix byte for y-protocols/sync messages (mirrors the DO constant). */
const MSG_SYNC = 0;

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
