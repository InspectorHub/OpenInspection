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

/**
 * Task 9c — a queued photo blob that is a DERIVED image (a baked annotation
 * PNG), not a raw camera upload. When present on a QueuedPhoto, the replay
 * transport routes the blob to the annotation endpoint (`replay-annotation`)
 * instead of the plain upload endpoint, carrying the annotate context below.
 */
export interface AnnotationDerivative {
    kind: 'annotation';
    /** index within the source item's photos[] array (the photo being annotated) */
    photoIndex: number;
    /** opaque annotation node JSON forwarded verbatim to the annotation endpoint */
    nodes: string;
    /** composite finding-key section, when the item lives under a section */
    sectionId?: string;
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
    /** N4 — skip preprocessing on replay when true (captured at enqueue time).
     *  Optional: legacy in-flight entries default to preprocessing (the safe
     *  privacy choice). */
    originalQuality?: boolean;
    /** Task 9c — when present, this queued blob is a derived image (e.g. a baked
     *  annotation PNG) that replays to a different endpoint than a raw upload.
     *  Absent for ordinary photo uploads. */
    derivative?: AnnotationDerivative;
}

/**
 * Plan 4 (Q3) — a queued crop derivative: a baked cropped JPEG that replays to
 * the crop endpoint (`replay-crop`) carrying the item/defect target + the crop
 * transform. Mirrors QueuedPhoto's lifecycle (the store is kind-agnostic).
 */
export interface QueuedCrop {
    seq: number;
    kind: 'crop';
    inspectionId: string;
    itemId: string;
    /** Index into the item/defect photos array whose crop derivative this is. */
    photoIndex: number;
    /** Source id for the composite finding key (defect photos); undefined for item photos. */
    sectionId?: string;
    /** Baked cropped JPEG (2048px long edge), produced client-side by bakeCrop. */
    blob: Blob;
    /** Re-editable crop transform in source-pixel coords (PhotoCropSchema shape). */
    crop: { aspect: string; orientation: 'landscape' | 'portrait'; x: number; y: number; width: number; height: number };
    enqueuedAt: number;
    attempts: number;
    status: 'pending' | 'failed';
}

export type QueueEntry = QueuedWrite | QueuedPhoto | QueuedCrop;

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

    /** Append a new crop-derivative entry; seq is assigned by the store. */
    putCrop(p: Omit<QueuedCrop, 'seq' | 'kind'>): Promise<QueuedCrop>;

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
