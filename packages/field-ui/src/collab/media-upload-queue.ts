/**
 * Offline media upload queue / drain engine (#181 PR-G infra).
 *
 * Pure orchestration over the local blob store (media-pending-store.ts). The
 * actual network upload is INJECTED via a `MediaUploader`, so unit tests drive
 * the full happy/failure paths with no server.
 *
 * Design:
 *  - `enqueueMedia` persists the record and returns its `pendingId`. The caller
 *    records `pendingUpload: true` + `pendingId` on the doc entry.
 *  - `drainMediaQueue` lists the inspection's pending records oldest-first and
 *    uploads each via the injected uploader. On success it calls `onUploaded`
 *    (so the caller swaps the doc entry pending→real key) THEN deletes the
 *    record. On failure it leaves the record queued and counts it — there is NO
 *    retry loop here: the trigger (G2: reconnect / `online` event) re-invokes
 *    `drainMediaQueue`, so we must only ensure items are never lost.
 *  - An in-flight guard (a module-level set keyed by inspectionId) prevents two
 *    concurrent drains for the same inspection from double-uploading a record.
 *
 * No React imports.
 */

import {
    putPendingMedia,
    listPendingMedia,
    deletePendingMedia,
    type PendingMediaRecord,
} from './media-pending-store';

// ─── Injected upload contract ──────────────────────────────────────────────────

/** The real R2 key(s) produced by uploading one pending record. */
export interface UploadResult {
    /** photo upload → the new R2 photo key. */
    key?:          string;
    /** crop upload → the new R2 cropped-derivative key. */
    croppedKey?:   string;
    /** annotate upload → the new R2 annotated-derivative key. */
    annotatedKey?: string;
}

export interface MediaUploader {
    /**
     * Upload the blob for one record and return its real R2 key(s).
     * Throws (rejects) on failure — the drain leaves the record queued.
     */
    upload(rec: PendingMediaRecord): Promise<UploadResult>;
}

export interface DrainDeps {
    inspectionId: string;
    uploader:     MediaUploader;
    /**
     * Called after a successful upload, BEFORE the record is deleted, so the
     * caller can swap the doc entry pending→real key. If this throws the record
     * is still deleted (the doc swap is the caller's responsibility to make
     * idempotent / retriable); the upload itself already succeeded.
     */
    onUploaded: (rec: PendingMediaRecord, result: UploadResult) => void;
}

export interface DrainSummary {
    uploaded: number;
    failed:   number;
}

// ─── In-flight guard ────────────────────────────────────────────────────────────

/**
 * Inspections with a drain currently in progress. A second `drainMediaQueue`
 * for the same inspection returns an empty summary immediately rather than
 * racing the first (which would let both read the same pending record and upload
 * it twice). Keyed by inspectionId so distinct inspections drain in parallel.
 */
const draining = new Set<string>();

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Persist a pending-media record and return its `pendingId`. The caller then
 * records `pendingUpload: true` + this id on the corresponding doc photo entry.
 *
 * Rejects if the underlying write fails (see putPendingMedia) — the caller must
 * not mark the doc entry pending when the blob did not land.
 */
export async function enqueueMedia(rec: PendingMediaRecord): Promise<string> {
    await putPendingMedia(rec);
    return rec.pendingId;
}

/**
 * Drain all pending media for one inspection (oldest first).
 *
 * For each record: `await uploader.upload(rec)`; on success call
 * `onUploaded(rec, result)` then `deletePendingMedia(rec.pendingId)`; on a
 * failed upload, leave the record queued and continue. Returns counts of
 * uploaded vs failed. Concurrent drains for the same inspection are coalesced
 * (the second returns `{ uploaded: 0, failed: 0 }`).
 */
export async function drainMediaQueue(deps: DrainDeps): Promise<DrainSummary> {
    const { inspectionId, uploader, onUploaded } = deps;

    if (draining.has(inspectionId)) {
        // Another drain owns this inspection's queue right now.
        return { uploaded: 0, failed: 0 };
    }
    draining.add(inspectionId);

    let uploaded = 0;
    let failed = 0;
    try {
        const pending = await listPendingMedia(inspectionId);
        for (const rec of pending) {
            let result: UploadResult;
            try {
                result = await uploader.upload(rec);
            } catch {
                // Upload failed — leave the record queued for the next drain.
                failed += 1;
                continue;
            }
            // Upload succeeded — swap the doc entry, then drop the local blob.
            onUploaded(rec, result);
            await deletePendingMedia(rec.pendingId);
            uploaded += 1;
        }
    } finally {
        draining.delete(inspectionId);
    }

    return { uploaded, failed };
}
