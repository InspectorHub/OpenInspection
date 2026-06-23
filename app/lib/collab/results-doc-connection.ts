/**
 * Pure (non-React) client connection to the InspectionDocDO WebSocket.
 *
 * Manages a Y.Doc with IndexedDB offline persistence and a Yjs sync-protocol
 * WebSocket provider to the authorized collab route. No React imports.
 *
 * Design choices:
 *  - IndexedDB is opened first; the WebSocket is opened ONLY inside the
 *    `persistence.once('synced')` callback. This prevents a race where a fresh
 *    empty remote state overwrites locally-persisted data before it is applied.
 *  - Awareness is intentionally absent. The production DO (InspectionDocDO)
 *    handles only MSG_SYNC (byte 0). Presence stays in InspectionPresenceDO.
 *  - The `WebSocketImpl` and `location` options are injectable so tests can
 *    drive the connection without a real browser WebSocket or window.location.
 *  - The `destroy()` function is idempotent; double-calling is safe.
 */

import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Framing prefix byte for y-protocols/sync messages (mirrors the DO constant). */
const MSG_SYNC = 0;

// ─── Public types ──────────────────────────────────────────────────────────────

/** Live state snapshot of the connection, mutated in-place by connectResultsDoc. */
export interface ResultsDocHandle {
    doc: Y.Doc;
    /** True after IndexedDB has restored its stored state to the doc. */
    persistenceSynced: boolean;
    /** True after the first Yjs sync step2 from the DO is applied. */
    synced: boolean;
}

export interface ConnectOptions {
    /**
     * Injectable WebSocket constructor for tests.
     * Defaults to globalThis.WebSocket when omitted.
     */
    WebSocketImpl?: typeof WebSocket;
    /**
     * Injectable origin for URL construction in tests.
     * Defaults to window.location when omitted.
     */
    location?: { protocol: string; host: string };
    /**
     * Called whenever persistenceSynced or synced flip so React wrappers
     * can trigger a re-render with the updated handle.
     */
    onChange?: (handle: ResultsDocHandle) => void;
}

// ─── URL builder ──────────────────────────────────────────────────────────────

/**
 * Build the WebSocket URL for the inspection collaborative doc endpoint.
 *
 * Converts `https:` → `wss:` and `http:` → `ws:`. The inspection id is
 * percent-encoded so ids containing slashes or other special characters route
 * correctly.
 */
export function buildCollabWsUrl(
    inspectionId: string,
    loc: { protocol: string; host: string },
): string {
    const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:';
    const path = `/api/inspections/${encodeURIComponent(inspectionId)}/collab/ws`;
    return `${wsProtocol}//${loc.host}${path}`;
}

// ─── Connection factory ────────────────────────────────────────────────────────

/**
 * Open a Y.Doc connected to the InspectionDocDO for `inspectionId`.
 *
 * Returns the mutable handle (flags flip in-place) and a `destroy()` that
 * tears everything down cleanly.
 *
 * Lifecycle:
 *   1. Y.Doc + IndexeddbPersistence are created immediately.
 *   2. A `doc.on('update')` forwarder is registered (skips echoes).
 *   3. `persistence.once('synced')` flips `persistenceSynced`, calls `onChange`,
 *      then opens the WebSocket so the remote sync happens AFTER local state is
 *      applied.
 *   4. On open, the client sends a sync step1 to the DO.
 *   5. Inbound MSG_SYNC frames are decoded:
 *      - step1 → reply with step2 (our current state).
 *      - step2 → flip `synced`, call `onChange`.
 *      - update → apply to doc (origin = ws, so the forwarder skips the echo).
 */
export function connectResultsDoc(
    inspectionId: string,
    opts: ConnectOptions = {},
): { handle: ResultsDocHandle; destroy: () => void } {
    const WS = opts.WebSocketImpl ?? globalThis.WebSocket;
    const loc = opts.location ?? (typeof window !== 'undefined' ? window.location : { protocol: 'https:', host: 'localhost' });

    // ── Yjs doc ──────────────────────────────────────────────────────────────

    const doc = new Y.Doc();

    // ── IndexedDB persistence ─────────────────────────────────────────────────
    // Database name is `results-<id>` (distinct from the POC `poc-collab-` prefix).

    const persistence = new IndexeddbPersistence('results-' + inspectionId, doc);

    // ── Mutable handle (mutated in-place; React wrapper reads it via onChange) ─

    const handle: ResultsDocHandle = {
        doc,
        persistenceSynced: false,
        synced: false,
    };

    let ws: InstanceType<typeof WebSocket> | null = null;
    let destroyed = false;

    // ── Local update forwarder ────────────────────────────────────────────────
    // Forward every local doc mutation to the server as a framed update message.
    // Skip updates whose origin === ws to avoid echoing frames back to the DO.

    const docUpdateHandler = (update: Uint8Array, origin: unknown): void => {
        if (origin === ws) return; // do not echo socket-received updates
        // Use the instance's own OPEN constant (not the global WebSocket.OPEN)
        // so this pure module never references a `WebSocket` global that may be
        // absent if it is imported/called outside a browser (e.g. SSR misuse).
        if (!ws || ws.readyState !== ws.OPEN) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeUpdate(encoder, update);
        ws.send(encoding.toUint8Array(encoder));
    };

    doc.on('update', docUpdateHandler);

    // ── Socket opener ─────────────────────────────────────────────────────────

    function openSocket(): void {
        if (destroyed) return;

        const url = buildCollabWsUrl(inspectionId, loc);
        ws = new WS(url);
        ws.binaryType = 'arraybuffer';

        ws.addEventListener('open', () => {
            if (!ws || destroyed) return;
            // Send sync step1 so the DO replies with step2 (its full state).
            const encoder = encoding.createEncoder();
            encoding.writeVarUint(encoder, MSG_SYNC);
            syncProtocol.writeSyncStep1(encoder, doc);
            ws.send(encoding.toUint8Array(encoder));
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            if (typeof ev.data === 'string') return; // only binary frames
            const raw = ev.data as ArrayBuffer;
            const data = new Uint8Array(raw);
            if (data.length === 0) return;

            const decoder = decoding.createDecoder(data);
            const msgType = decoding.readVarUint(decoder);

            if (msgType !== MSG_SYNC) return; // drop unknown frame types

            // replyEncoder is populated by readSyncMessage when the inbound
            // message is a step1 (so we can send back a step2).
            const replyEncoder = encoding.createEncoder();
            encoding.writeVarUint(replyEncoder, MSG_SYNC);

            // Pass ws as the transaction origin so the update forwarder above
            // skips echoing this back to the server.
            const syncMsgType = syncProtocol.readSyncMessage(
                decoder,
                replyEncoder,
                doc,
                ws, // origin
            );

            if (
                syncMsgType === syncProtocol.messageYjsSyncStep1 &&
                ws &&
                ws.readyState === ws.OPEN
            ) {
                // DO sent us a step1 — reply with our step2.
                ws.send(encoding.toUint8Array(replyEncoder));
            }

            if (syncMsgType === syncProtocol.messageYjsSyncStep2 && !handle.synced) {
                // First step2 received → we are now synced with the DO.
                handle.synced = true;
                opts.onChange?.(handle);
            }
        });

        ws.addEventListener('close', () => {
            // No automatic reconnect in this version — Task 9 can layer it on.
        });

        ws.addEventListener('error', () => {
            try { ws?.close(); } catch { /* already closing */ }
        });
    }

    // ── Wait for IndexedDB before opening the socket ──────────────────────────
    // This is the persistence-synced gate: the socket is opened ONLY after
    // IndexedDB restores its stored state, so a fresh empty remote cannot
    // race-overwrite local data.

    persistence.once('synced', () => {
        if (destroyed) return;
        handle.persistenceSynced = true;
        opts.onChange?.(handle);
        openSocket();
    });

    // ── Destroy ───────────────────────────────────────────────────────────────

    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        doc.off('update', docUpdateHandler);
        try { ws?.close(); } catch { /* already closing */ }
        persistence.destroy().catch(() => { /* ignore */ });
        doc.destroy();
    }

    return { handle, destroy };
}
