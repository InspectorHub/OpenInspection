/**
 * Durable local blob store for offline media (#181 PR-G infra).
 *
 * A tiny IndexedDB wrapper, separate from the Yjs y-indexeddb doc store. While a
 * client is offline (or the R2 PUT has not yet succeeded) the client-produced
 * binary — a photo, a cropped jpeg, or an annotated png — lives here keyed by a
 * `pendingId`. The doc entry carries `pendingUpload: true` + the same
 * `pendingId`, so the editor can resolve the bytes to a local blob URL and the
 * upload queue (media-upload-queue.ts) can later drain the binary to R2.
 *
 * Pure, no React. Every export is Promise-based and resolves-on-settle: a
 * transient IndexedDB failure NEVER rejects (mirrors the resolve-on-error
 * pattern in `deleteResultsDb` in results-doc-connection.ts) — losing a
 * best-effort read is acceptable; a thrown promise wedging the drain loop is not.
 * The one exception is `putPendingMedia`, which must surface a write failure so
 * the caller does not record a `pendingUpload` entry whose bytes never landed.
 */

// ─── Constants ──────────────────────────────────────────────────────────────

/** IndexedDB database name (distinct from the `results-<id>` Yjs doc stores). */
const DB_NAME = 'collab-media-pending';
/** Single object store, keyed by `pendingId`. */
const STORE = 'pending';
/** Schema version. Bump only when the object-store layout changes. */
const DB_VERSION = 1;

// ─── Record shape ─────────────────────────────────────────────────────────────

export type PendingMediaKind = 'photo' | 'crop' | 'annotate';

export interface PendingMediaRecord {
    /** crypto.randomUUID() — the IndexedDB primary key. */
    pendingId:    string;
    inspectionId: string;
    /** Composite finding key the results doc is keyed by. */
    findingKey:   string;
    kind:         PendingMediaKind;
    /** The client-produced bytes (photo / cropped jpeg / annotated png). */
    blob:         Blob;
    /** crop / annotate: the original photo `key` being derived from. */
    photoKey?:    string;
    /** crop: the PhotoCropTransform (kept opaque here — the store does not interpret it). */
    crop?:        unknown;
    /** annotate: the serialized Konva node tree. */
    nodesJson?:   string;
    /** ms epoch (the caller passes Date.now()). */
    enqueuedAt:   number;
}

// ─── IndexedDB open helper ────────────────────────────────────────────────────

/**
 * Open (and, on first use / version bump, upgrade) the pending-media database.
 *
 * Rejects only on a hard open/upgrade failure; callers wrap this in
 * resolve-on-settle helpers so a transient failure degrades gracefully.
 */
function openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) {
                db.createObjectStore(STORE, { keyPath: 'pendingId' });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error('indexedDB.open failed'));
        req.onblocked = () => reject(new Error('indexedDB.open blocked'));
    });
}

/**
 * Run `fn` inside a transaction of `mode` over the pending store.
 *
 * The result is captured from the request's `onsuccess`, but the promise only
 * RESOLVES on the transaction's `oncomplete` — i.e. after the write is durably
 * committed. Resolving on `request.onsuccess` (which fires before commit) would
 * let a subsequent read open a fresh connection mid-commit and miss the data.
 */
function withStore<T>(
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        openDb().then((db) => {
            let tx: IDBTransaction;
            try {
                tx = db.transaction(STORE, mode);
            } catch (err) {
                db.close();
                reject(err);
                return;
            }
            let req: IDBRequest<T>;
            try {
                req = fn(tx.objectStore(STORE));
            } catch (err) {
                db.close();
                reject(err);
                return;
            }
            let result: T;
            req.onsuccess = () => { result = req.result; };
            req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'));
            tx.oncomplete = () => { db.close(); resolve(result); };
            tx.onabort = () => {
                db.close();
                reject(tx.error ?? new Error('IndexedDB transaction aborted'));
            };
        }).catch(reject);
    });
}

// ─── Narrowing ────────────────────────────────────────────────────────────────

/**
 * Type-guard: a stored value is a well-formed PendingMediaRecord.
 *
 * Note on `blob`: we require it to be PRESENT (a non-null object) but do NOT
 * assert `instanceof Blob`. The structured-clone round-trip in some IndexedDB
 * implementations (notably fake-indexeddb under happy-dom in tests) revives the
 * stored Blob as a plain object that fails `instanceof Blob` even though real
 * browsers return a genuine Blob. Gating on `instanceof` would silently drop
 * every persisted record. The blob is opaque to this store anyway — only the
 * uploader consumes it — so a presence check is the correct, portable guard.
 */
function isPendingMediaRecord(v: unknown): v is PendingMediaRecord {
    if (typeof v !== 'object' || v === null) return false;
    const r = v as Record<string, unknown>;
    return (
        typeof r.pendingId === 'string' &&
        typeof r.inspectionId === 'string' &&
        typeof r.findingKey === 'string' &&
        (r.kind === 'photo' || r.kind === 'crop' || r.kind === 'annotate') &&
        typeof r.blob === 'object' && r.blob !== null &&
        typeof r.enqueuedAt === 'number'
    );
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Persist a pending-media record (the bytes survive a page reload). Rejects on a
 * write failure so the caller does NOT mark a doc entry `pendingUpload` whose
 * blob never landed (a silent loss would orphan the doc entry forever).
 */
export function putPendingMedia(rec: PendingMediaRecord): Promise<void> {
    return withStore<IDBValidKey>('readwrite', (store) => store.put(rec)).then(() => undefined);
}

/**
 * Read one record by `pendingId`. Resolves `undefined` when absent OR on any
 * transient IndexedDB failure (best-effort read — the drain loop must not wedge).
 */
export function getPendingMedia(pendingId: string): Promise<PendingMediaRecord | undefined> {
    return withStore<unknown>('readonly', (store) => store.get(pendingId))
        .then((v) => (isPendingMediaRecord(v) ? v : undefined))
        .catch(() => undefined);
}

/**
 * List all pending records (optionally filtered to one inspection), oldest
 * first by `enqueuedAt`. Resolves `[]` on any transient IndexedDB failure.
 */
export function listPendingMedia(inspectionId?: string): Promise<PendingMediaRecord[]> {
    return withStore<unknown[]>('readonly', (store) => store.getAll())
        .then((rows) => {
            const recs = rows.filter(isPendingMediaRecord);
            const filtered = inspectionId === undefined
                ? recs
                : recs.filter((r) => r.inspectionId === inspectionId);
            return filtered.sort((a, b) => a.enqueuedAt - b.enqueuedAt);
        })
        .catch(() => []);
}

/**
 * Delete one record by `pendingId`. Resolves on success OR on any transient
 * IndexedDB failure — a failed cleanup must not wedge the drain loop (the next
 * drain re-attempts the delete after a successful upload).
 */
export function deletePendingMedia(pendingId: string): Promise<void> {
    return withStore<undefined>('readwrite', (store) => store.delete(pendingId) as IDBRequest<undefined>)
        .then(() => undefined)
        .catch(() => undefined);
}
