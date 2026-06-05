/**
 * Offline write/photo queue persistence.
 *
 * Implementations:
 *   - IndexedDB  (browser, `queue-storage.idb.ts`)
 *   - In-memory  (tests + environments without IDB, `queue-storage.memory.ts`)
 *
 * `seq` is assigned by the store and is monotonically increasing across BOTH
 * writes and photos, establishing the global replay order.
 */

export interface QueuedWrite {
    seq: number;
    kind: 'write';
    inspectionId: string;
    itemId?: string;
    field?: string;
    intent: string;
    payload: Record<string, unknown>;
    enqueuedAt: number;
    attempts: number;
    status: 'pending' | 'failed';
}

export interface QueuedPhoto {
    seq: number;
    kind: 'photo';
    inspectionId: string;
    itemId: string;
    name: string;
    blob: Blob;
    enqueuedAt: number;
    attempts: number;
    status: 'pending' | 'failed';
}

export type QueueEntry = QueuedWrite | QueuedPhoto;

export interface QueueStorage {
    /** Append a new write entry; seq is assigned by the store. */
    putWrite(w: Omit<QueuedWrite, 'seq' | 'kind'>): Promise<QueuedWrite>;

    /**
     * Replace the PENDING write with the same (inspectionId, itemId, field) if
     * one exists.  The old entry is removed and a new entry is inserted at a new
     * seq (re-enqueue semantics).  If no matching PENDING entry is found the
     * call behaves exactly like `putWrite`.
     *
     * FAILED entries with the same key are left untouched — they are frozen for
     * manual retry / inspection.
     */
    coalesce(w: Omit<QueuedWrite, 'seq' | 'kind'>): Promise<QueuedWrite>;

    /** Append a new photo entry; seq is assigned by the store. */
    putPhoto(p: Omit<QueuedPhoto, 'seq' | 'kind'>): Promise<QueuedPhoto>;

    /**
     * Return all PENDING entries in ascending seq order.
     * If `inspectionId` is provided, filter to that inspection only.
     */
    listPending(inspectionId?: string): Promise<QueueEntry[]>;

    /** Flip the entry's status to `'failed'`. No-op if the seq does not exist. */
    markFailed(seq: number): Promise<void>;

    /** Remove the entry entirely. No-op if the seq does not exist. */
    remove(seq: number): Promise<void>;

    /** Return total counts by status across all entries. */
    counts(): Promise<{ pending: number; failed: number }>;
}
