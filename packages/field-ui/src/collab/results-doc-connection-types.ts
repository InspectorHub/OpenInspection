/**
 * The public types of `connectResultsDoc`, split out of `results-doc-connection.ts` to keep that file under its size cap.
 * Import them from `results-doc-connection` (it re-exports all of them).
 */

import type * as Y from 'yjs';
import type { ResultsDocLineageFactory } from './results-doc-lineage';

// ─── Public types ──────────────────────────────────────────────────────────────

/** Live state snapshot of the connection, mutated in-place by connectResultsDoc. */
export interface ResultsDocHandle {
    doc: Y.Doc;
    /** True after IndexedDB has restored its stored state to the doc. */
    persistenceSynced: boolean;
    /** True after the first Yjs sync step2 from the DO is applied. */
    synced: boolean;
    /** True once the server closed the socket with 4409: the report is published and takes no edits. No reconnect follows; the host decides what to show. */
    locked?: boolean;
    /** True while a stale offline copy could not be backed up and so was neither discarded nor synced; the connection retries on its next open. */
    lineageHold?: boolean;
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
type ResultsDocPersistenceFactory = (name: string, doc: Y.Doc) => ResultsDocPersistence;

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
    /**
     * The lineage guard's per-inspection store (see `results-doc-lineage.ts`). Omitted means no guard: the connection hands
     * its local state back whatever generation the server announces, as before the guard existed.
     */
    lineage?: ResultsDocLineageFactory;
}

