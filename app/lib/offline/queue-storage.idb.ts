/**
 * IndexedDB QueueStorage implementation.
 *
 * Database : `oi-offline`  (version 1)
 * Store    : `queue`       (autoIncrement, keyPath: `seq`)
 * Indexes  : `by-status`  on `status`
 *             `by-inspection` on `inspectionId`
 *
 * NOTE: happy-dom does not provide IndexedDB, so this module has no unit tests.
 *       Browser acceptance tests cover the IDB path.
 */

import type {
    QueueEntry,
    QueuedPhoto,
    QueuedWrite,
    QueueStorage,
} from '~/lib/offline/queue-storage';

const DB_NAME = 'oi-offline';
const DB_VERSION = 1;
const STORE_NAME = 'queue';

/** Returns true when the IndexedDB global is available (browser or fake-idb env). */
export function idbAvailable(): boolean {
    return typeof indexedDB !== 'undefined';
}

/** Wrap an IDBRequest in a Promise. */
function req<T>(request: IDBRequest<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Open (or upgrade) the `oi-offline` database. */
function openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        const open = indexedDB.open(DB_NAME, DB_VERSION);

        open.onupgradeneeded = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                const store = db.createObjectStore(STORE_NAME, {
                    keyPath: 'seq',
                    autoIncrement: true,
                });
                store.createIndex('by-status', 'status', { unique: false });
                store.createIndex('by-inspection', 'inspectionId', { unique: false });
            }
        };

        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
        open.onblocked = () => reject(new Error('IDB open blocked'));
    });
}

/** Obtain a read-write transaction over the `queue` store. */
function rwTx(db: IDBDatabase): IDBObjectStore {
    return db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
}

/** Obtain a read-only transaction over the `queue` store. */
function roTx(db: IDBDatabase): IDBObjectStore {
    return db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME);
}

/**
 * Create an IndexedDB-backed QueueStorage.
 *
 * The returned object lazily opens the database on the first call.
 * All public methods mirror the in-memory implementation's semantics exactly,
 * including the coalesce failed-entry rule.
 */
export function createIdbQueueStorage(): QueueStorage {
    let dbPromise: Promise<IDBDatabase> | null = null;

    function getDb(): Promise<IDBDatabase> {
        if (!dbPromise) dbPromise = openDb();
        return dbPromise;
    }

    return {
        async putWrite(w) {
            const db = await getDb();
            const store = rwTx(db);
            const entry: Omit<QueuedWrite, 'seq'> = { ...w, kind: 'write' };
            const seq = (await req(store.add(entry))) as number;
            return { ...entry, seq };
        },

        async coalesce(w) {
            const db = await getDb();

            // Find a PENDING write matching (inspectionId, itemId, field).
            // FAILED entries with the same key are left untouched.
            const all = await req<QueueEntry[]>(roTx(db).getAll());
            const match = all.find(
                (e): e is QueuedWrite =>
                    e.kind === 'write' &&
                    e.status === 'pending' &&
                    e.inspectionId === w.inspectionId &&
                    e.itemId === w.itemId &&
                    e.field === w.field,
            );

            if (match) {
                await req(rwTx(db).delete(match.seq));
            }

            const store = rwTx(db);
            const entry: Omit<QueuedWrite, 'seq'> = { ...w, kind: 'write' };
            const seq = (await req(store.add(entry))) as number;
            return { ...entry, seq };
        },

        async putPhoto(p) {
            const db = await getDb();
            const store = rwTx(db);
            const entry: Omit<QueuedPhoto, 'seq'> = { ...p, kind: 'photo' };
            const seq = (await req(store.add(entry))) as number;
            return { ...entry, seq };
        },

        async listPending(inspectionId?) {
            const db = await getDb();
            const all = await req<QueueEntry[]>(roTx(db).getAll());
            return all
                .filter(
                    (e) =>
                        e.status === 'pending' &&
                        (inspectionId === undefined || e.inspectionId === inspectionId),
                )
                .sort((a, b) => a.seq - b.seq);
        },

        async markFailed(seq) {
            const db = await getDb();
            const store = rwTx(db);
            const entry = await req<QueueEntry | undefined>(store.get(seq));
            if (entry) {
                await req(store.put({ ...entry, status: 'failed' }));
            }
        },

        async remove(seq) {
            const db = await getDb();
            await req(rwTx(db).delete(seq));
        },

        async counts() {
            const db = await getDb();
            const all = await req<QueueEntry[]>(roTx(db).getAll());
            let pending = 0;
            let failed = 0;
            for (const e of all) {
                if (e.status === 'pending') pending++;
                else if (e.status === 'failed') failed++;
            }
            return { pending, failed };
        },
    };
}
