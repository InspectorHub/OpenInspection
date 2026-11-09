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
 *  - The WebSocket opens ONLY once the persistence's `whenSynced` has resolved, so a fresh empty remote cannot
 *    overwrite locally-persisted data before it is applied.
 *  - No awareness: the DO handles only MSG_SYNC; presence stays in InspectionPresenceDO.
 *  - `WebSocketImpl` is injectable for tests; `destroy()` is idempotent.
 *  - Lineage guard (`results-doc-lineage.ts`): the server's first frame names its history; a store from another history
 *    is discarded (after a one-slot backup) before any local state is sent.
 */

import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { reconnectDelayMs } from './results-doc-backoff';
import { MSG_GENERATION, backUpStale, judgeLineage, readFrameGeneration, topUpBackup, type DiscardedStoreInfo } from './results-doc-lineage';

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

export type { ResultsDocHandle, ResultsDocPersistence, ConnectOptions } from './results-doc-connection-types';
import type { ResultsDocHandle, ConnectOptions } from './results-doc-connection-types';

/** WebSocket close code the results document uses for "this report is published" (the socket twin of HTTP 409 REPORT_PUBLISHED). */
const REPORT_PUBLISHED_CLOSE_CODE = 4409;

export { reconnectDelayMs };

/** A lineage-store failure never blocks the connection; the guard just loses that one write. */
function warnLineage(): void {
    console.warn('Results document: the lineage record could not be written on this device.');
}

// ─── Connection factory ────────────────────────────────────────────────────────

/**
 * Open a Y.Doc connected to the InspectionDocDO for `inspectionId`.
 *
 * Returns the mutable handle (flags flip in-place) and a `destroy()`.
 *
 * Lifecycle: Y.Doc + persistence at once; a `doc.on('update')` forwarder (skips echoes); once `whenSynced` resolves
 * the socket opens and (after the lineage is judged) a step1 is sent. Inbound MSG_SYNC: step1 -> reply step2, step2 ->
 * flip `synced`, update -> apply. MSG_RESTORE drops all local state (Y.Doc + IndexedDB) and resyncs from scratch.
 */
export function connectResultsDoc(
    inspectionId: string,
    opts: ConnectOptions,
): { handle: ResultsDocHandle; destroy: () => void } {
    const WS = opts.WebSocketImpl ?? globalThis.WebSocket;

    // ── Reassignable doc + persistence ─────────────────────────────────────────
    // NOT const: a MSG_RESTORE (or a discard) rebuilds both; the forwarder and message handler read the CURRENT `doc`.

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

    // ── Lineage guard (see results-doc-lineage.ts) ──────────────────────────────
    // `storedGen` is what this device's store last synced with (read before the first socket opens).
    // `lineageChecked` is false from socket open until the server's first frame is judged: local state is neither forwarded
    // nor answered with before then. Without a lineage store the guard is off and it is always true.
    const lineage = opts.lineage?.(inspectionId);
    let storedGen: string | null = null;
    let lineageChecked = !lineage;
    let generationSeen = false; // the socket's first frame was a generation frame (so the server has the guard)

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
        if (destroyed || restoring || handle.locked) return;
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
        if (destroyed || handle.locked) return;
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
        if (!lineageChecked) return; // the first frame has not told us whether this store belongs to the server's history
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
    // A restore (or a lineage mismatch) cannot be applied additively: Yjs updates union, so deletions would not revert.
    // Drop ALL local state: detach the forwarder and destroy the persistence, delete the IndexedDB database so the
    // rebuilt doc starts EMPTY, build a FRESH doc + persistence, then send a fresh step1; the step2 reply applies to
    // the empty doc with no contamination.
    async function handleRestore(newGen: string | null = null, discard: DiscardedStoreInfo | null = null): Promise<void> {
        if (destroyed || restoring) return; // re-entrancy / post-destroy guard
        restoring = true;
        let aborted = false;
        let saved: Uint8Array | null = null;
        const oldDoc = doc;
        try {
            // (0) Detach the forwarder FIRST, then (a discard only) back the stale store up in the same tick, so nothing lands between the
            // two. If the backup cannot be written the discard is abandoned: the store stays, nothing is sent, the socket is reopened.
            doc.off('update', docUpdateHandler);
            if (discard && lineage) {
                try { saved = await backUpStale(lineage, oldDoc, discard); } catch {
                    console.error('Results document: the stale offline copy could not be backed up, so it was kept and not synced; will retry.', { inspectionId });
                    aborted = true;
                    bindDoc();
                    Object.assign(handle, { synced: false, lineageHold: true });
                    opts.onChange?.(handle);
                    return;
                }
            }
            if (destroyed) return;
            // (1) Tear down the current persistence.
            const oldPersistence = persistence;
            await Promise.resolve(oldPersistence.destroy()).catch(() => { /* ignore */ });
            if (destroyed) return; // destroyed while awaiting

            // (2) Clear local IndexedDB so the rebuilt doc starts empty (best-effort: a failed clear never wedges the resync).
            await Promise.resolve(oldPersistence.clearData?.()).catch(() => { /* ignore */ });
            if (destroyed) return;
            if (discard && lineage) await topUpBackup(lineage, oldDoc, discard, saved); // edits typed while the store was torn down
            if (newGen !== null && lineage) { storedGen = newGen; await lineage.write(newGen).catch(warnLineage); }
            if (destroyed) return;
            // (3) Fresh doc + fresh persistence, re-wired and published.
            const freshDoc = new Y.Doc();
            doc = freshDoc;
            persistence = opts.persistence(resultsDocName(inspectionId), freshDoc);
            bindDoc();
            oldDoc.destroy();
            lineageChecked = true;
            if (handle.lineageHold) handle.lineageHold = false;

            handle.doc = freshDoc;
            handle.synced = false; // not yet synced with the restored remote state
            // persistenceSynced stays true: the fresh store is empty, and we resync via step1 on the open socket.
            opts.onChange?.(handle);

            // (4) Re-pull the authoritative restored state on the open socket.
            sendStep1();
        } finally {
            restoring = false;
            if (aborted) { try { ws?.close(); } catch { /* already closing */ } }
            if (aborted || !ws || ws.readyState !== ws.OPEN) scheduleReconnect(); // the close handler ignores a drop that happens mid-restore
        }
    }

    /** The local state may be spoken now: judged keep/adopt (or no guard). Sends the step 1 that was held back while undecided. */
    function markChecked(): void {
        if (lineageChecked) return;
        lineageChecked = true;
        if (handle.lineageHold) handle.lineageHold = false;
        sendStep1();
    }

    /** The server announced which history it holds: keep, adopt (nothing recorded yet) or discard the local store before any reply. */
    function handleGeneration(gen: string | null): void {
        if (destroyed || restoring) return;
        generationSeen = true;
        if (gen === null || !lineage) { markChecked(); return; }
        if (judgeLineage(storedGen, gen) === 'discard') {
            console.warn('Results document: the server holds a different history than this device; the offline copy was discarded (one backup slot kept).', { inspectionId });
            void handleRestore(gen, { storedGen: storedGen ?? '', serverGen: gen });
            return;
        }
        markChecked();
        if (storedGen === null) { storedGen = gen; void lineage.write(gen).catch(warnLineage); }
    }

    // ── Socket opener ─────────────────────────────────────────────────────────

    function openSocket(): void {
        if (destroyed) return;
        if (!lineage) { connectSocket(); return; }
        // The recorded generation is re-read at every open: another tab may have changed it since this one last looked.
        void lineage.read().catch(() => storedGen).then((gen) => {
            if (destroyed || (ws && (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING))) return;
            storedGen = gen;
            connectSocket();
        });
    }

    function connectSocket(): void {
        lineageChecked = !lineage;
        generationSeen = false;
        const url = opts.wsUrl(inspectionId);
        ws = new WS(url);
        ws.binaryType = 'arraybuffer';

        ws.addEventListener('open', () => {
            if (!ws || destroyed) return;
            // Send sync step1 so the DO replies with step2 (its full state); with the guard, only once the lineage is judged.
            if (lineageChecked) sendStep1();
        });

        ws.addEventListener('message', (ev: MessageEvent) => {
            if (typeof ev.data === 'string') return; // only binary frames
            const raw = ev.data as ArrayBuffer;
            const data = new Uint8Array(raw);
            if (data.length === 0) return;

            const decoder = decoding.createDecoder(data);
            const msgType = decoding.readVarUint(decoder);

            if (msgType === MSG_GENERATION) { handleGeneration(readFrameGeneration(decoder)); return; }

            if (msgType === MSG_RESTORE) {
                // Control frame: drop local state and resync from scratch (an optional body names the new generation).
                void handleRestore(readFrameGeneration(decoder));
                return;
            }

            if (msgType !== MSG_SYNC) return; // drop unknown frame types
            if (restoring) return; // a discard is under way; its fresh step1 re-pulls everything
            if (!lineageChecked) {
                // A server with the guard sends the generation first; a sync frame first means one without it. After a generation
                // frame that has not been settled (a backup failed), sync frames are dropped instead.
                if (generationSeen) return;
                markChecked();
            }

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

        ws.addEventListener('close', (ev) => {
            // Auto-reconnect: a dropped socket (network loss, server restart) is
            // reopened with exponential backoff. The restore path resyncs on the
            // SAME open socket, so its close (if any) is guarded by `restoring`.
            // Destroyed connections never reconnect.
            if (destroyed || restoring) return;
            // Published: a reopened socket would be closed the same way, forever. Stop and say so.
            if (ev.code === REPORT_PUBLISHED_CLOSE_CODE) {
                clearReconnectTimer();
                handle.locked = true;
                opts.onChange?.(handle);
                return;
            }
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
