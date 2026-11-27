/**
 * The leftovers of an offline-package import: the package of inspections an
 * import did not bring in, kept so its download survives a reload (#485).
 *
 * The import page holds the original file only in memory (`bytes` in
 * `useOfflinePackageImport`), so a reload or a navigation away lost the
 * download at the moment the inspector needed it. When an import finishes
 * with inspections left behind, the extracted held-back package is written to
 * ONE slot here; the next import overwrites it, a clean import clears it.
 * The slot is per browser profile, so the tenant it was exported for is
 * recorded with it and a leftover is only offered to that same company.
 *
 * Shape mirrors `~/lib/field/web-lineage-store`: raw IndexedDB, one database,
 * one object store, and every failure resolves to "nothing there" / "not
 * written" — a storage failure must never fail an import or wedge the page.
 * The store is injectable so tests can use the in-memory one: happy-dom has
 * no `indexedDB`.
 */
export interface LeftoverPackage {
    /** The extracted held-back package: only the inspections left behind. */
    bytes: Uint8Array;
    ids: string[];
    /** The company the package was exported for; only it may download it. */
    tenantId: string;
    savedAt: number;
}

export interface LeftoverStore {
    read(): Promise<LeftoverPackage | null>;
    save(pkg: LeftoverPackage): Promise<void>;
    clear(): Promise<void>;
}

const DB_NAME = "offline-package-leftovers";
const STORE = "meta";
const SLOT = "slot";

function openDb(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB open failed"));
    });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    try {
        return await new Promise<T>((resolve, reject) => {
            const tx = db.transaction(STORE, mode);
            const req = fn(tx.objectStore(STORE));
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error ?? new Error("indexedDB request failed"));
            tx.onerror = () => reject(tx.error ?? new Error("indexedDB transaction failed"));
            tx.onabort = () => reject(tx.error ?? new Error("indexedDB transaction aborted"));
        });
    } finally {
        db.close();
    }
}

/** The IndexedDB slot. Never throws: without storage there is simply no leftover. */
export function indexedDbLeftoverStore(): LeftoverStore {
    if (typeof indexedDB === "undefined") {
        return { read: () => Promise.resolve(null), save: () => Promise.resolve(), clear: () => Promise.resolve() };
    }
    return {
        read: () => withStore("readonly", (store) => store.get(SLOT)).then(
            (value) => (isLeftover(value) ? value : null),
            () => null,
        ),
        save: (pkg) => withStore("readwrite", (store) => store.put(pkg, SLOT)).then(
            () => undefined,
            () => undefined,
        ),
        clear: () => withStore("readwrite", (store) => store.delete(SLOT)).then(
            () => undefined,
            () => undefined,
        ),
    };
}

function isLeftover(value: unknown): value is LeftoverPackage {
    if (typeof value !== "object" || value === null) return false;
    const v = value as Partial<LeftoverPackage>;
    return v.bytes instanceof Uint8Array && Array.isArray(v.ids) && typeof v.tenantId === "string" && typeof v.savedAt === "number";
}

/** An in-memory slot for tests (happy-dom has no `indexedDB`). */
export function memoryLeftoverStore(): LeftoverStore & { slot: LeftoverPackage | null } {
    let slot: LeftoverPackage | null = null;
    return {
        get slot() {
            return slot;
        },
        read: () => Promise.resolve(slot),
        save: (pkg) => {
            slot = pkg;
            return Promise.resolve();
        },
        clear: () => {
            slot = null;
            return Promise.resolve();
        },
    };
}
