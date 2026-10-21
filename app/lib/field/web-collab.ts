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
import { resultsDocName } from "@core/field-ui/collab/results-doc-connection";
import type {
    ResultsDocPersistence,
} from "@core/field-ui/collab/results-doc-connection";
import type { OfflinePurgeHost } from "@core/field-ui/collab/offline-purge";
import type { ResultsDocHost } from "@core/field-ui/collab/use-results-doc";

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
 * correctly.
 */
export function buildCollabWsUrl(
    inspectionId: string,
    loc: { protocol: string; host: string },
): string {
    const wsProtocol = loc.protocol === "https:" ? "wss:" : "ws:";
    const path = `/api/inspections/${encodeURIComponent(inspectionId)}/collab/ws`;
    return `${wsProtocol}//${loc.host}${path}`;
}

/** The collab URL on the page's own origin (https/localhost when there is no window). */
export function webCollabWsUrl(inspectionId: string): string {
    const loc = typeof window !== "undefined"
        ? window.location
        : { protocol: "https:", host: "localhost" };
    return buildCollabWsUrl(inspectionId, loc);
}

/** Subscribe to the browser's `online` event; returns the unsubscribe. */
export function webSubscribeOnline(onOnline: () => void): () => void {
    if (typeof window === "undefined") return () => { /* nothing to unsubscribe */ };
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
}

/** The three host pieces `useResultsDoc` needs, as one stable reference. */
export const webCollabHost: ResultsDocHost = {
    persistence: webPersistence,
    wsUrl: webCollabWsUrl,
    subscribeOnline: webSubscribeOnline,
};

/** Erase one inspection's persisted results doc from this browser profile. */
export function webClearResultsData(inspectionId: string): Promise<void> {
    return deleteDatabase(resultsDocName(inspectionId));
}

/** What `purgeInspectionOfflineData` needs from the web host. */
export const webOfflinePurgeHost: OfflinePurgeHost = {
    available: () => typeof indexedDB !== "undefined",
    clearResultsData: webClearResultsData,
};
