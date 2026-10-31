/**
 * Offline media upload queue / drain engine (#181 PR-G infra).
 *
 * Pure orchestration over a local blob store. Both ends are INJECTED: the store
 * (`PendingMediaStore`, the contract in ../media-types; the web host backs it
 * with IndexedDB in `app/lib/field/web-media-store.ts`) and the network upload
 * (a `MediaUploader`), so unit tests drive the full happy/failure paths with no
 * browser and no server.
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

import type { PendingMediaRecord, PendingMediaStore } from '../media-types';

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

/**
 * Thrown by an uploader when the host refused these very bytes and will refuse them every time (an unsupported file,
 * an oversized one). The drain then stops retrying the record: it reports it through `onRejected` and removes it. The
 * message is the host's fixed reason code (for example `TOO_LARGE`). A network failure or a 5xx is NOT this: it stays an
 * ordinary rejection and the record is retried on the next drain.
 */
export class PermanentUploadError extends Error {
    constructor(reason: string) {
        super(reason);
        this.name = 'PermanentUploadError';
    }
}

export interface DrainDeps {
    inspectionId: string;
    /** Where the pending records live. */
    store:        PendingMediaStore;
    uploader:     MediaUploader;
    /**
     * Called after a successful upload, BEFORE the record is deleted, so the
     * caller can swap the doc entry pending→real key. If this throws the record
     * is still deleted (the doc swap is the caller's responsibility to make
     * idempotent / retriable); the upload itself already succeeded.
     */
    onUploaded: (rec: PendingMediaRecord, result: UploadResult) => void;
    /**
     * Called when the local blob of an UPLOADED record could not be deleted. The doc swap and the upload
     * already happened, so nothing is lost; the next drain retries only the delete (it never uploads the
     * record again). Optional: the host decides whether to log it.
     */
    onCleanupFailed?: (rec: PendingMediaRecord, error: unknown) => void;
    /**
     * Called once for a record whose upload failed with a `PermanentUploadError` (`reason` is its message), after
     * which the record is deleted and never uploaded again. The caller removes the matching pending doc entry and
     * tells the person. Such a record is not counted in `failed`.
     */
    onRejected?: (rec: PendingMediaRecord, reason: string) => void;
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

/**
 * Records whose upload AND doc swap succeeded but whose local delete has not (yet). If the delete fails, the
 * record is still listed by the next drain; without this set that drain would upload the same blob a second
 * time and swap the doc entry again. Held for the session (module lifetime): after a reload the doc entry no
 * longer says "pending", and the swap that resolves it is a no-op on an already resolved entry.
 */
const swapped = new Set<string>();

/** Records uploaded whose doc swap threw: kept in the store, not uploaded again this session (a later session retries). */
const swapFailed = new Set<string>();

/** Records the host permanently refused whose local delete failed: reported already, never uploaded again. */
const refused = new Set<string>();

// ─── Public API ─────────────────────────────────────────────────────────────────

/**
 * Persist a pending-media record and return its `pendingId`. The caller then
 * records `pendingUpload: true` + this id on the corresponding doc photo entry.
 *
 * Rejects if the underlying write fails (`PendingMediaStore.put` must reject) —
 * the caller must not mark the doc entry pending when the blob did not land.
 */
export async function enqueueMedia(store: PendingMediaStore, rec: PendingMediaRecord): Promise<string> {
    await store.put(rec);
    return rec.pendingId;
}

/**
 * Drain all pending media for one inspection (oldest first).
 *
 * For each record: `await uploader.upload(rec)`; on success call
 * `onUploaded(rec, result)` then `store.delete(rec.pendingId)`; on a
 * failed upload, leave the record queued and continue. If `onUploaded` throws the
 * record is also kept (counted failed, not uploaded again this session) and the drain continues. Returns counts of
 * uploaded vs failed. Concurrent drains for the same inspection are coalesced
 * (the second returns `{ uploaded: 0, failed: 0 }`).
 */
export async function drainMediaQueue(deps: DrainDeps): Promise<DrainSummary> {
    const { inspectionId, store, uploader, onUploaded } = deps;

    if (draining.has(inspectionId)) {
        // Another drain owns this inspection's queue right now.
        return { uploaded: 0, failed: 0 };
    }
    draining.add(inspectionId);

    let uploaded = 0;
    let failed = 0;
    try {
        // Oldest first, whatever order the store happens to list in.
        const pending = [...(await store.list(inspectionId))].sort((a, b) => a.createdAt - b.createdAt);
        for (const rec of pending) {
            if (swapFailed.has(rec.pendingId)) continue;
            if (!swapped.has(rec.pendingId) && !refused.has(rec.pendingId)) {
                let result: UploadResult | undefined;
                try {
                    result = await uploader.upload(rec);
                } catch (error) {
                    if (error instanceof PermanentUploadError) {
                        // The host will never accept these bytes: report once, then stop carrying them.
                        refused.add(rec.pendingId);
                        try {
                            deps.onRejected?.(rec, error.message);
                        } catch {
                            // A throwing host callback must not wedge the queue: the record is already refused, so it is
                            // still deleted below and the drain moves on. Fixed wording only; the host's error text is
                            // not echoed.
                            console.error('A rejected-photo handler failed; the refused photo was still removed from the local queue:', rec.pendingId);
                        }
                    } else {
                        // Upload failed — leave the record queued for the next drain.
                        failed += 1;
                        continue;
                    }
                }
                if (result) {
                    // Upload succeeded — swap the doc entry, then drop the local blob.
                    try {
                        onUploaded(rec, result);
                    } catch {
                        // The bytes ARE on the server but the doc entry was not swapped, so it still says "pending". The
                        // record is KEPT: deleting it would strand a placeholder with nothing to re-link it, and a photo
                        // must never be lost. Held for this session so it is not uploaded again here; a later session
                        // uploads and swaps it again, at the cost of a possible duplicate server copy. Counted failed;
                        // the drain goes on. Fixed wording only; the host's error text is not echoed.
                        swapFailed.add(rec.pendingId);
                        failed += 1;
                        console.error('An uploaded-photo handler failed; the photo stays in the local queue:', rec.pendingId);
                        continue;
                    }
                    swapped.add(rec.pendingId);
                    uploaded += 1;
                }
            }
            // A failed cleanup must not wedge the drain: the next drain re-attempts the delete only.
            try {
                await store.delete(rec.pendingId);
                swapped.delete(rec.pendingId);
                refused.delete(rec.pendingId);
            } catch (error) {
                deps.onCleanupFailed?.(rec, error);
            }
        }
    } finally {
        draining.delete(inspectionId);
    }

    return { uploaded, failed };
}
