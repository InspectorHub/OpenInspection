/**
 * Web implementation of the field-ui `PendingMediaStore`: durable local blob
 * storage for offline media (#181 PR-G infra), backed by IndexedDB.
 *
 * A tiny IndexedDB wrapper, separate from the Yjs y-indexeddb doc store. While a
 * client is offline (or the R2 PUT has not yet succeeded) the client-produced
 * binary (a photo, a cropped jpeg, or an annotated png) lives here keyed by a
 * `pendingId`. The doc entry carries `pendingUpload: true` + the same
 * `pendingId`, so the editor can resolve the bytes to a local blob URL and the
 * upload queue can later drain the binary to R2.
 *
 * ⚠️ ON-DISK COMPATIBILITY. Pending photos already sit in users' browsers, so the
 * database name, version, object store, key path and the stored record shape
 * below are frozen (`web-media-store.test.ts` pins them). The contract record
 * (`PendingMediaRecord`: `meta`, `createdAt`) is mapped to and from that stored
 * shape at this boundary; do not store the contract shape directly.
 *
 * Every read and delete resolves on settle: a transient IndexedDB failure NEVER
 * rejects, because a thrown promise wedging the drain loop is worse than a lost
 * best-effort read. The one exception is `put`, which must surface a write
 * failure so the caller does not record a `pendingUpload` entry whose bytes
 * never landed.
 */
import type { PendingMediaRecord, PendingMediaStore } from "@core/field-ui/media-types";
import type { PhotoCropTransform } from "@core/field-ui/data-source-types";
import { headBytes, sniffPhotoType } from "@core/field-ui/shared/media-sniff";
import { MAX_PHOTO_BYTES } from "@core/field-ui/shared/photo-limits";

// ─── On-disk layout (frozen) ──────────────────────────────────────────────────

/** IndexedDB database name (distinct from the `results-<id>` Yjs doc stores). */
export const WEB_MEDIA_DB_NAME = "collab-media-pending";
/** Single object store, keyed by `pendingId`. */
export const WEB_MEDIA_STORE_NAME = "pending";
export const WEB_MEDIA_KEY_PATH = "pendingId";
/** Schema version. Bump only when the object-store layout changes. */
export const WEB_MEDIA_DB_VERSION = 1;

/** The record exactly as it is stored. */
export interface StoredPendingMedia {
    /** crypto.randomUUID(), the IndexedDB primary key. */
    pendingId: string;
    inspectionId: string;
    /** Composite finding key the results doc is keyed by. */
    findingKey: string;
    kind: "photo" | "crop" | "annotate";
    /** The client-produced bytes (photo / cropped jpeg / annotated png). */
    blob: Blob;
    /** crop / annotate: the original photo `key` being derived from. */
    photoKey?: string;
    /** crop: the PhotoCropTransform, opaque to the store. */
    crop?: unknown;
    /** annotate: the serialized Konva node tree. */
    nodesJson?: string;
    /** ms epoch. */
    enqueuedAt: number;
}

// ─── Contract <-> stored shape ────────────────────────────────────────────────

/** Composite finding key format: `{unit}:{sectionId}:{itemId}`. */
function itemIdFromFindingKey(findingKey: string): string {
    const parts = findingKey.split(":");
    return parts[parts.length - 1] ?? findingKey;
}

function sectionIdFromFindingKey(findingKey: string): string | undefined {
    const parts = findingKey.split(":");
    return parts.length >= 3 ? parts[parts.length - 2] : undefined;
}

export function toStored(rec: PendingMediaRecord): StoredPendingMedia {
    const base = {
        pendingId: rec.pendingId,
        inspectionId: rec.inspectionId,
        findingKey: rec.meta.findingKey,
        blob: rec.blob,
        enqueuedAt: rec.createdAt,
    };
    if (rec.kind === "photo") {
        // The stored shape has no defect addressing; refuse rather than silently
        // attach a defect photo to its item.
        if (rec.meta.targetType === "defect") throw new Error("web media store cannot queue a defect photo");
        return { ...base, kind: "photo" };
    }
    if (rec.kind === "crop") {
        return { ...base, kind: "crop", photoKey: rec.meta.photoKey, crop: rec.meta.crop };
    }
    return { ...base, kind: "annotate", photoKey: rec.meta.photoKey, nodesJson: rec.meta.nodesJson };
}

/**
 * `itemId` and `sectionId` are derived from the finding key, as the drain always
 * did. `photoIndex` was never stored; it is -1 (unknown), which is safe because
 * the uploader re-resolves the index from the live document by `photoKey`.
 */
export function fromStored(row: StoredPendingMedia): PendingMediaRecord {
    const common = {
        pendingId: row.pendingId,
        inspectionId: row.inspectionId,
        blob: row.blob,
        createdAt: row.enqueuedAt,
    };
    const itemId = itemIdFromFindingKey(row.findingKey);
    const sectionId = sectionIdFromFindingKey(row.findingKey);
    if (row.kind === "photo") {
        return { ...common, kind: "photo", meta: { targetType: "item", findingKey: row.findingKey, itemId } };
    }
    const derivative = {
        findingKey: row.findingKey,
        itemId,
        photoIndex: -1,
        photoKey: row.photoKey ?? "",
        ...(sectionId ? { sectionId } : {}),
    };
    if (row.kind === "crop") {
        return {
            ...common,
            kind: "crop",
            meta: { ...derivative, crop: (row.crop ?? {}) as PhotoCropTransform },
        };
    }
    return { ...common, kind: "annotate", meta: { ...derivative, nodesJson: row.nodesJson ?? "" } };
}

// ─── IndexedDB plumbing ───────────────────────────────────────────────────────

/**
 * Open (and, on first use / version bump, upgrade) the pending-media database.
 * Rejects only on a hard open/upgrade failure; callers wrap this in
 * resolve-on-settle helpers so a transient failure degrades gracefully.
 */
function openDb(): Promise<IDBDatabase> {
    return new Promise<IDBDatabase>((resolve, reject) => {
        let req: IDBOpenDBRequest;
        try {
            req = indexedDB.open(WEB_MEDIA_DB_NAME, WEB_MEDIA_DB_VERSION);
        } catch (err) {
            reject(err);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(WEB_MEDIA_STORE_NAME)) {
                db.createObjectStore(WEB_MEDIA_STORE_NAME, { keyPath: WEB_MEDIA_KEY_PATH });
            }
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error("indexedDB.open failed"));
        req.onblocked = () => reject(new Error("indexedDB.open blocked"));
    });
}

/**
 * Run `fn` inside a transaction of `mode` over the pending store.
 *
 * The result is captured from the request's `onsuccess`, but the promise only
 * RESOLVES on the transaction's `oncomplete`, i.e. after the write is durably
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
                tx = db.transaction(WEB_MEDIA_STORE_NAME, mode);
            } catch (err) {
                db.close();
                reject(err);
                return;
            }
            let req: IDBRequest<T>;
            try {
                req = fn(tx.objectStore(WEB_MEDIA_STORE_NAME));
            } catch (err) {
                db.close();
                reject(err);
                return;
            }
            let result: T;
            req.onsuccess = () => { result = req.result; };
            req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
            tx.oncomplete = () => { db.close(); resolve(result); };
            tx.onabort = () => {
                db.close();
                reject(tx.error ?? new Error("IndexedDB transaction aborted"));
            };
        }).catch(reject);
    });
}

/**
 * Type-guard: a stored value is a well-formed row.
 *
 * `blob` must be PRESENT (a non-null object) but is not asserted `instanceof
 * Blob`: the structured-clone round-trip in some IndexedDB implementations
 * (notably fake-indexeddb under happy-dom in tests) revives the stored Blob as a
 * plain object, even though real browsers return a genuine Blob. Gating on
 * `instanceof` would silently drop every persisted record.
 */
function isStoredPendingMedia(v: unknown): v is StoredPendingMedia {
    if (typeof v !== "object" || v === null) return false;
    const r = v as Record<string, unknown>;
    return (
        typeof r.pendingId === "string" &&
        typeof r.inspectionId === "string" &&
        typeof r.findingKey === "string" &&
        (r.kind === "photo" || r.kind === "crop" || r.kind === "annotate") &&
        typeof r.blob === "object" && r.blob !== null &&
        typeof r.enqueuedAt === "number"
    );
}

// ─── Admission ────────────────────────────────────────────────────────────────

/** A refusal the editor can explain: `code` is one of the fixed reasons it classifies, the message is never shown. */
function rejection(code: "UNSUPPORTED_TYPE" | "TOO_LARGE", message: string): Error & { code: string } {
    return Object.assign(new Error(message), { code });
}

/**
 * Refuse a photo the server would permanently refuse, before it is queued: over the server's photo ceiling, or bytes
 * that are not a jpeg, png or heic image. The type is decided by the leading bytes with the server's own sniffer,
 * never by the declared type or the file name. HEIC is accepted as a type: whether this browser can decode it is
 * a separate step. Only a user-chosen photo is checked; the crop and annotation bytes are made by the editor itself.
 */
async function assertAdmissible(rec: PendingMediaRecord): Promise<void> {
    if (rec.kind !== "photo") return;
    if (rec.blob.size > MAX_PHOTO_BYTES) throw rejection("TOO_LARGE", "photo is over the size limit");
    if (sniffPhotoType(await headBytes(rec.blob)) === null) throw rejection("UNSUPPORTED_TYPE", "photo is not a jpeg, png or heic image");
}

// ─── The store ────────────────────────────────────────────────────────────────

export const webMediaStore: PendingMediaStore = {
    /**
     * Rejects on a write failure (see the module note), and with a coded error (`UNSUPPORTED_TYPE`, `TOO_LARGE`) for a
     * photo the server would permanently refuse.
     */
    put: async (rec) => {
        // Admission first: a photo about to be refused is not converted, so its specific reason is never masked.
        await assertAdmissible(rec);
        const row = toStored(rec);
        await withStore<IDBValidKey>("readwrite", (store) => store.put(row));
    },

    /** Resolves null when absent OR on any transient IndexedDB failure. */
    get: (pendingId) =>
        withStore<unknown>("readonly", (store) => store.get(pendingId))
            .then((v) => (isStoredPendingMedia(v) ? fromStored(v) : null))
            .catch(() => null),

    /** Oldest first; resolves [] on any transient IndexedDB failure. */
    list: (inspectionId) =>
        withStore<unknown[]>("readonly", (store) => store.getAll())
            .then((rows) => {
                const stored = rows.filter(isStoredPendingMedia);
                const filtered = inspectionId === undefined
                    ? stored
                    : stored.filter((r) => r.inspectionId === inspectionId);
                return filtered.sort((a, b) => a.enqueuedAt - b.enqueuedAt).map(fromStored);
            })
            .catch(() => []),

    /** Resolves on success OR on a transient failure; the next drain re-attempts. */
    delete: (pendingId) =>
        withStore<undefined>("readwrite", (store) => store.delete(pendingId) as IDBRequest<undefined>)
            .then(() => undefined)
            .catch(() => undefined),

    /** A blob URL for the pending bytes; the caller revokes it. */
    objectUrl: async (pendingId) => {
        const rec = await webMediaStore.get(pendingId);
        // Under happy-dom + fake-indexeddb the blob is revived as a plain
        // object; only a real Blob can become a URL.
        if (!rec || typeof URL === "undefined" || !(rec.blob instanceof Blob)) return null;
        return URL.createObjectURL(rec.blob);
    },
};
