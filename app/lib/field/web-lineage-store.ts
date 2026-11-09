/**
 * Web host of the results document's lineage guard (`@core/field-ui/collab/results-doc-lineage`).
 *
 * Two small IndexedDB databases per inspection, both separate from the y-indexeddb `results-<id>` data so that clearing the
 * data on a restore or a discard never takes them with it:
 *   - `results-gen-<id>`: the generation this device's store last synced with.
 *   - `results-discarded-<id>`: ONE backup slot holding the full Yjs state of the last store the guard discarded, with both
 *     generations and the time. The next discard overwrites it. Nothing reads it automatically: it exists so support can
 *     recover offline edits (`Y.applyUpdate` of `update` into a scratch document shows what the device held).
 * Every failure resolves to "nothing there" / "not written": the guard must never wedge a connection.
 */
import type { DiscardedStoreInfo, ResultsDocLineageStore } from "@core/field-ui/collab/results-doc-lineage";

const STORE = "meta";

export const lineageDbName = (inspectionId: string): string => "results-gen-" + inspectionId;
export const discardedDbName = (inspectionId: string): string => "results-discarded-" + inspectionId;

function open(name: string): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(name, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
}

async function readKey<T>(name: string, key: string): Promise<T | undefined> {
    const db = await open(name);
    try {
        return await new Promise<T | undefined>((resolve, reject) => {
            const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
            req.onsuccess = () => resolve(req.result as T | undefined);
            req.onerror = () => reject(req.error ?? new Error("indexedDB read failed"));
        });
    } finally {
        db.close();
    }
}

async function writeKey(name: string, key: string, value: string | DiscardedRecord): Promise<void> {
    const db = await open(name);
    try {
        await new Promise<void>((resolve, reject) => {
            const tx = db.transaction(STORE, "readwrite");
            tx.objectStore(STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error ?? new Error("indexedDB write failed"));
            tx.onabort = () => reject(tx.error ?? new Error("indexedDB write aborted"));
        });
    } finally {
        db.close();
    }
}

/** The shape of the backup slot's single record. */
export interface DiscardedRecord extends DiscardedStoreInfo {
    update: Uint8Array;
    atMs: number;
}

/** The lineage store for one inspection on this browser profile. */
export function webLineageStore(inspectionId: string): ResultsDocLineageStore {
    return {
        read: async () => {
            const gen = await readKey<string>(lineageDbName(inspectionId), "gen").catch(() => undefined);
            return typeof gen === "string" ? gen : null;
        },
        write: (gen) => writeKey(lineageDbName(inspectionId), "gen", gen),
        saveDiscarded: (update, info) => writeKey(discardedDbName(inspectionId), "slot", { ...info, update, atMs: Date.now() }),
    };
}

/** What the backup slot holds, or null. For support tooling and tests. */
export async function readDiscardedStore(inspectionId: string): Promise<DiscardedRecord | null> {
    return (await readKey<DiscardedRecord>(discardedDbName(inspectionId), "slot").catch(() => undefined)) ?? null;
}
