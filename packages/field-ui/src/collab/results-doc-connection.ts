/**
 * Pure (non-React) client connection to the InspectionDocDO WebSocket.
 *
 * Manages a Y.Doc with IndexedDB offline persistence and a Yjs sync-protocol
 * WebSocket provider to the authorized collab route. No React imports.
 *
 * The persistence store, the socket URL and the "network is back" signal are
 * supplied by the host through `ConnectOptions`; this module reaches for no
 * browser global itself. The web host lives in `app/lib/field/web-collab.ts`.
 *
 * Design choices:
 *  - IndexedDB is opened first; the WebSocket is opened ONLY once the
 *    persistence's `whenSynced` has resolved (the host's persistence is the
 *    IndexedDB mirror on the web). This prevents a race where a fresh
 *    empty remote state overwrites locally-persisted data before it is applied.
 *  - Awareness is intentionally absent. The production DO (InspectionDocDO)
 *    handles only MSG_SYNC (byte 0). Presence stays in InspectionPresenceDO.
 *  - The `WebSocketImpl` option is injectable so tests can drive the connection
 *    without a real browser WebSocket.
 *  - The `destroy()` function is idempotent; double-calling is safe.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Framing prefix byte for y-protocols/sync messages (mirrors the DO constant). */
const MSG_SYNC = 0;

/**
 * Framing byte for the restore control frame (a bare signal, no body). The DO
 * sends this after a version restore; on receipt the client drops its local
 * state (Y.Doc + IndexedDB) and resyncs from scratch. The literal `2` is
 * duplicated DO-side in `server/durable-objects/inspection-doc.ts` (MSG_RESTORE)
 * — there is no shared package; keep the two in sync (mirrors the duplicated
 * MSG_SYNC = 0 pattern).
 */
const MSG_RESTORE = 2;

// ─── Persistence naming ──────────────────────────────────────────────────────────

/**
 * The persistence name for an inspection's results doc. The host's persistence
 * factory decides what to do with it; the web host uses it verbatim as the
 * IndexedDB database name, so existing offline data keeps loading.
 */
export function resultsDocName(inspectionId: string): string {
    return 'results-' + inspectionId;
}

// ─── Public types ──────────────────────────────────────────────────────────────

/** Live state snapshot of the connection, mutated in-place by connectResultsDoc. */
export interface ResultsDocHandle {
    doc: Y.Doc;
    /** True after IndexedDB has restored its stored state to the doc. */
    persistenceSynced: boolean;
    /** True after the first Yjs sync step2 from the DO is applied. */
    synced: boolean;
}

/** What a persistence store handed back by the host must offer. */
export interface ResultsDocPersistence {
    /** Resolves once the stored state has been applied to the doc. */
    whenSynced: Promise<unknown>;
    /** Release the store (close the database); the stored data stays. */
    destroy(): Promise<void> | void;
    /**
     * Erase the stored data. Called on MSG_RESTORE, after `destroy()`, so the
     * rebuilt doc starts empty. Best-effort: it must not reject the resync.
     */
    clearData?(): Promise<void>;
}

/** Host-supplied factory: open a persistence store for `doc` under `name`. */
export type ResultsDocPersistenceFactory = (name: string, doc: Y.Doc) => ResultsDocPersistence;

export interface ConnectOptions {
    /** Host persistence factory (IndexedDB on the web). Required. */
    persistence: ResultsDocPersistenceFactory;
    /** Host WebSocket URL builder for an inspection id. Required. */
    wsUrl: (inspectionId: string) => string;
    /**
     * Subscribe to the host's "network is back" signal; returns an unsubscribe.
     * When it fires the backoff resets and the socket reopens immediately.
     * Omitted means no such signal (reconnect relies on the backoff timer).
     */
    subscribeOnline?: (onOnline: () => void) => () => void;
    /**
     * Injectable WebSocket constructor for tests.
     * Defaults to globalThis.WebSocket when omitted.
     */
    WebSocketImpl?: typeof WebSocket;
    /**
     * Called whenever persistenceSynced or synced flip so React wrappers
     * can trigger a re-render with the updated handle.
     */
    onChange?: (handle: ResultsDocHandle) => void;
    /**
     * #181 PR-G — called EACH time `handle.synced` flips to true: on the initial
     * connect AND on every successful reconnect (after an offline window or a
     * dropped socket). The editor uses this as the trigger to drain the offline
     * media queue, so freshly-captured photos/crops/annotations upload as soon as
     * the collab socket is healthy again.
     */
    onSynced?: () => void;
}

// ─── Reconnect backoff ──────────────────────────────────────────────────────────

/** First reconnect delay (ms); doubles each attempt up to RECONNECT_MAX_MS — kept short so a cold DO self-heals before the user notices. */
const RECONNECT_BASE_MS = 400;
/** Backoff ceiling (ms): attempts never wait longer than this between reopens. */
const RECONNECT_MAX_MS = 30_000;

/** Compute the exponential backoff delay for the Nth (0-based) reconnect attempt. */
export function reconnectDelayMs(attempt: number): number {
    const exp = RECONNECT_BASE_MS * Math.pow(2, Math.max(0, attempt));
    return Math.min(exp, RECONNECT_MAX_MS);
}

// ─── Connection factory ────────────────────────────────────────────────────────

/**
 * Open a Y.Doc connected to the InspectionDocDO for `inspectionId`.
 *
 * Returns the mutable handle (flags flip in-place) and a `destroy()` that
 * tears everything down cleanly.
 *
 * Lifecycle:
 *   1. Y.Doc + the host's persistence are created immediately.
 *   2. A `doc.on('update')` forwarder is registered (skips echoes).
 *   3. `persistence.whenSynced` resolving flips `persistenceSynced`, calls `onChange`,
 *      then opens the WebSocket so the remote sync happens AFTER local state is
 *      applied.
 *   4. On open, the client sends a sync step1 to the DO.
 *   5. Inbound MSG_SYNC frames are decoded:
 *      - step1 → reply with step2 (our current state).
 *      - step2 → flip `synced`, call `onChange`.
 *      - update → apply to doc (origin = ws, so the forwarder skips the echo).
 *   6. An inbound MSG_RESTORE control frame drops all local state (Y.Doc +
 *      IndexedDB), rebuilds a fresh empty doc, and resyncs via a new step1 — so
 *      a version restore converges even when additive Yjs merge cannot.
 */
export function connectResultsDoc(
    inspectionId: string,
    opts: ConnectOptions,
): { handle: ResultsDocHandle; destroy: () => void } {
    const WS = opts.WebSocketImpl ?? globalThis.WebSocket;

    // ── Reassignable doc + persistence ─────────────────────────────────────────
    // `doc` and `persistence` are NOT const: a MSG_RESTORE control frame rebuilds
    // both (drop + resync). The update-forwarder + message handler always read
    // the CURRENT `doc` via these closure variables, so the rebuild re-wires
    // cleanly. Database name is `results-<id>` (distinct from the POC prefix).

    let doc = new Y.Doc();
    let persistence = opts.persistence(resultsDocName(inspectionId), doc);

    // ── Mutable handle (mutated in-place; React wrapper reads it via onChange) ─

    const handle: ResultsDocHandle = {
        doc,
        persistenceSynced: false,
        synced: false,
    };

    let ws: InstanceType<typeof WebSocket> | null = null;
    let destroyed = false;
    /** Re-entrancy guard: a MSG_RESTORE arriving mid-reset must not re-trigger. */
    let restoring = false;

    // ── Reconnect state ─────────────────────────────────────────────────────────
    // On an unexpected socket close (not destroyed, not mid-restore) we reopen
    // with exponential backoff; a `window 'online'` event reopens immediately and
    // resets the backoff. `reconnectAttempts` resets to 0 once a fresh step2
    // (synced) arrives, so a flapping connection that briefly syncs starts its
    // backoff over rather than compounding from a stale count.
    let reconnectAttempts = 0;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    /** Clear any pending reconnect timer (idempotent). */
    function clearReconnectTimer(): void {
        if (reconnectTimer !== null) {
            clearTimeout(reconnectTimer);
            reconnectTimer = null;
        }
    }

    /**
     * Schedule a reconnect after the current backoff delay, unless one is already
     * scheduled, the connection is destroyed, or a restore is in flight (the
     * restore path resyncs on the still-open socket and must not race a reopen).
     */
    function scheduleReconnect(): void {
        if (destroyed || restoring) return;
        if (reconnectTimer !== null) return; // a reopen is already pending
        const delay = reconnectDelayMs(reconnectAttempts);
        reconnectAttempts += 1;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (destroyed || restoring) return;
            // Only reopen if there is no live/connecting socket.
            if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) return;
            openSocket();
        }, delay);
    }

    /**
     * `window 'online'` handler: the network just came back. Reset the backoff and
     * reopen now (cancelling any pending delayed reopen) so field merges + the
     * media-queue drain happen with no wait.
     */
    function handleOnline(): void {
        if (destroyed) return;
        reconnectAttempts = 0;
        clearReconnectTimer();
        if (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING)) return;
        openSocket();
    }

    const unsubscribeOnline = opts.subscribeOnline?.(handleOnline);

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

    /** Attach the forwarder to the CURRENT doc. */
    function bindDoc(): void {
        doc.on('update', docUpdateHandler);
    }

    /** Send a sync step1 from the CURRENT (possibly empty) doc on the open socket. */
    function sendStep1(): void {
        if (!ws || ws.readyState !== ws.OPEN) return;
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_SYNC);
        syncProtocol.writeSyncStep1(encoder, doc);
        ws.send(encoding.toUint8Array(encoder));
    }

    // ── Restore handler (drop + resync) ─────────────────────────────────────────
    // On a MSG_RESTORE control frame the authoritative doc was replaced by a
    // version restore. Yjs updates are additive (union), so a connected client
    // that already holds post-restore edits cannot have deletions reverted by a
    // plain update broadcast. We therefore drop ALL local state and resync:
    //   1. Detach the forwarder + destroy the current persistence (closes the DB).
    //   2. Delete the IndexedDB database so the rebuilt doc starts EMPTY
    //      (otherwise persistence would restore the stale state and re-contaminate
    //      the merge).
    //   3. Build a FRESH Y.Doc + fresh persistence, re-wire, publish via onChange.
    //   4. Send a fresh step1 on the still-open socket; the DO replies with a
    //      step2 carrying the full restored state, which applies cleanly to the
    //      empty doc with NO contamination from the dropped edits.
    async function handleRestore(): Promise<void> {
        if (destroyed || restoring) return; // re-entrancy / post-destroy guard
        restoring = true;
        try {
            // (1) Detach forwarder + tear down current persistence.
            doc.off('update', docUpdateHandler);
            const oldPersistence = persistence;
            const oldDoc = doc;
            await Promise.resolve(oldPersistence.destroy()).catch(() => { /* ignore */ });
            if (destroyed) return; // destroyed while awaiting

            // (2) Clear local IndexedDB so the rebuilt doc starts empty.
            // Best-effort: a failed clear must never wedge the resync.
            await Promise.resolve(oldPersistence.clearData?.()).catch(() => { /* ignore */ });
            if (destroyed) return;

            // (3) Fresh doc + fresh persistence, re-wired and published.
            const freshDoc = new Y.Doc();
            doc = freshDoc;
            persistence = opts.persistence(resultsDocName(inspectionId), freshDoc);
            bindDoc();
            oldDoc.destroy();

            handle.doc = freshDoc;
            handle.synced = false; // not yet synced with the restored remote state
            // persistenceSynced semantics: the fresh empty store will fire its own
            // 'synced'; leave the flag true (local state IS settled — it is empty)
            // since the socket is already open and we resync via step1 directly.
            opts.onChange?.(handle);

            // (4) Re-pull the authoritative restored state on the open socket.
            sendStep1();
        } finally {
            restoring = false;
        }
    }

    // ── Socket opener ─────────────────────────────────────────────────────────

    function openSocket(): void {
        if (destroyed) return;

        const url = opts.wsUrl(inspectionId);
        ws = new WS(url);
        ws.binaryType = 'arraybuffer';

        ws.addEventListener('open', () => {
            if (!ws || destroyed) return;
            // Send sync step1 so the DO replies with step2 (its full state).
            sendStep1();
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            if (typeof ev.data === 'string') return; // only binary frames
            const raw = ev.data as ArrayBuffer;
            const data = new Uint8Array(raw);
            if (data.length === 0) return;

            const decoder = decoding.createDecoder(data);
            const msgType = decoding.readVarUint(decoder);

            if (msgType === MSG_RESTORE) {
                // Control frame: drop local state and resync from scratch.
                void handleRestore();
                return;
            }

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

            if (syncMsgType === syncProtocol.messageYjsSyncStep2) {
                // A fresh step2 → we are synced with the DO. Reset the reconnect
                // backoff (a healthy sync earns a clean slate) and fire onSynced
                // EACH time (initial connect + every reconnect) so the editor can
                // re-drain the offline media queue. The handle flag flips on the
                // first step2 only; the onSynced trigger fires on every one.
                reconnectAttempts = 0;
                if (!handle.synced) {
                    handle.synced = true;
                    opts.onChange?.(handle);
                }
                opts.onSynced?.();
            }
        });

        ws.addEventListener('close', () => {
            // Auto-reconnect: a dropped socket (network loss, server restart) is
            // reopened with exponential backoff. The restore path resyncs on the
            // SAME open socket, so its close (if any) is guarded by `restoring`.
            // Destroyed connections never reconnect.
            if (destroyed || restoring) return;
            scheduleReconnect();
        });

        ws.addEventListener('error', () => {
            try { ws?.close(); } catch { /* already closing */ }
        });
    }

    // ── Wire the initial doc + wait for IndexedDB before opening the socket ────
    // This is the persistence-synced gate: the socket is opened ONLY after
    // IndexedDB restores its stored state, so a fresh empty remote cannot
    // race-overwrite local data.

    bindDoc();

    persistence.whenSynced.then(() => {
        if (destroyed) return;
        handle.persistenceSynced = true;
        opts.onChange?.(handle);
        openSocket();
    }, () => { /* a store that fails to open never opens the socket, as before */ });

    // ── Destroy ───────────────────────────────────────────────────────────────

    function destroy(): void {
        if (destroyed) return;
        destroyed = true;
        clearReconnectTimer();
        unsubscribeOnline?.();
        doc.off('update', docUpdateHandler);
        try { ws?.close(); } catch { /* already closing */ }
        Promise.resolve(persistence.destroy()).catch(() => { /* ignore */ });
        doc.destroy();
    }

    return { handle, destroy };
}
