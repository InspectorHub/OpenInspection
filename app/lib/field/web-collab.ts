/**
 * Web host for the field-ui collab connection.
 *
 * `@core/field-ui` is host-agnostic: it takes its persistence store, its
 * WebSocket URL and its "network is back" signal as options. This file supplies
 * the browser's versions of all three, plus the device-local cleanup the delete
 * flow needs. Everything that touches `indexedDB`, `window` or `location` for
 * the results document lives here.
 */
import type * as Y from "yjs";
import { IndexeddbPersistence } from "y-indexeddb";
import { connectResultsDoc, resultsDocName } from "@core/field-ui/collab/results-doc-connection";
import type {
    ResultsDocPersistence,
} from "@core/field-ui/collab/results-doc-connection";
import { purgeInspectionOfflineData } from "@core/field-ui/collab/offline-purge";
import type { OfflinePurgeHost } from "@core/field-ui/collab/offline-purge";
import type { CollabConnector } from "@core/field-ui/data-source";
import type { ResultsDocHost } from "@core/field-ui/collab/use-results-doc";
import { webMediaStore } from "./web-media-store";
import { discardedDbName, lineageDbName, webLineageStore } from "./web-lineage-store";

/**
 * Delete an IndexedDB database by name, resolving once the delete settles.
 * Resolves on success, block, OR error so a restore-resync is never wedged by a
 * transient IndexedDB failure (best-effort cleanup — the fresh empty doc + remote
 * step2 are the authoritative convergence path).
 */
function deleteDatabase(name: string): Promise<void> {
    return new Promise<void>((resolve) => {
        try {
            const req = indexedDB.deleteDatabase(name);
            req.onsuccess = () => resolve();
            req.onerror = () => resolve();
            req.onblocked = () => resolve();
        } catch {
            resolve();
        }
    });
}

/**
 * Open the y-indexeddb mirror of a results doc. `name` is `results-<id>` (what
 * the web app has always used), so data written before this seam existed keeps
 * loading. `clearData` drops the database; the connection calls it after
 * `destroy()` on a version restore.
 */
export function webPersistence(name: string, doc: Y.Doc): ResultsDocPersistence {
    const persistence = new IndexeddbPersistence(name, doc);
    return {
        whenSynced: persistence.whenSynced,
        destroy: () => persistence.destroy(),
        clearData: () => deleteDatabase(name),
    };
}

/**
 * Build the WebSocket URL for the inspection collaborative doc endpoint.
 *
 * Converts `https:` -> `wss:` and `http:` -> `ws:`. The inspection id is
 * percent-encoded so ids containing slashes or other special characters route
 * correctly. `gen` (the generation the open document belongs to) rides as `?gen=`: the server refuses a socket naming another history.
 */
export function buildCollabWsUrl(
    inspectionId: string,
    loc: { protocol: string; host: string },
    gen?: string | null,
): string {
    const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const path = `/api/inspections/${encodeURIComponent(inspectionId)}/collab/ws`;
    return `${wsProtocol}//${loc.host}${path}${gen ? `?gen=${encodeURIComponent(gen)}` : ""}`;
}

/** The collab URL on the page's own origin (https/localhost when there is no window). */
export function webCollabWsUrl(inspectionId: string, gen?: string | null): string {
    const loc = typeof window !== "undefined"
        ? window.location
        : { protocol: "https:", host: "localhost" };
    return buildCollabWsUrl(inspectionId, loc, gen);
}

/** Subscribe to the browser's `online` event; returns the unsubscribe. */
export function webSubscribeOnline(onOnline: () => void): () => void {
    if (typeof window === "undefined") return () => { /* nothing to unsubscribe */ };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
}

/** The host pieces `useResultsDoc` needs (persistence, socket URL, online signal, lineage store), as one stable reference. */
export const webCollabHost: ResultsDocHost = {
    persistence: webPersistence,
    wsUrl: webCollabWsUrl,
    subscribeOnline: webSubscribeOnline,
    lineage: webLineageStore,
};

/** Erase one inspection's persisted results doc from this browser profile. */
export async function webClearResultsData(inspectionId: string): Promise<void> {
    // The lineage record and the discarded-store backup belong to the same inspection: they go with it.
    await Promise.all([resultsDocName(inspectionId), lineageDbName(inspectionId), discardedDbName(inspectionId)].map(deleteDatabase));
}

/** What `purgeInspectionOfflineData` needs from the web host. */
export const webOfflinePurgeHost: OfflinePurgeHost = {
    available: () => typeof indexedDB !== "undefined",
    media: webMediaStore,
    clearResultsData: webClearResultsData,
};

/**
 * The web `FieldDataSource.collab`: the results-document connection and the offline purge over this
 * host's pieces. `connect` opens the connection at once (the socket opens after IndexedDB has applied its
 * stored state, as `connectResultsDoc` guarantees) and returns a live handle: `doc` is read through a getter
 * because a version restore replaces the document, and `persistenceSynced` settles the first time IndexedDB
 * has applied its state.
 */
export const webCollabConnector: CollabConnector = {
    connect(inspectionId, opts) {
        let markPersisted: () => void = () => undefined;
        const persistenceSynced = new Promise<void>((resolve) => {
            markPersisted = resolve;
        });
        const { handle, destroy } = connectResultsDoc(inspectionId, {
            ...webCollabHost,
            onChange: (updated) => {
                if (updated.persistenceSynced) markPersisted();
                opts.onChange?.();
            },
            ...(opts.onSynced ? { onSynced: opts.onSynced } : {}),
        });
        return {
            get doc() {
                return handle.doc;
            },
            persistenceSynced,
            synced: () => handle.synced,
            locked: () => handle.locked === true,
            held: () => handle.lineageHold === true,
            destroy,
        };
    },
    async purge(inspectionId) {
        await purgeInspectionOfflineData(inspectionId, webOfflinePurgeHost);
    },
};
