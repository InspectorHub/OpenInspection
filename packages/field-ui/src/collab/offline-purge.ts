/**
 * Erase one inspection's locally cached FIELD DATA from this device.
 *
 * ── WHY THIS EXISTS (F55) ───────────────────────────────────────────────────
 *
 * Deleting an inspection runs `deleteInspectionCascade` on the server: every
 * inspection-scoped row and every R2 object goes. Nothing touched the DEVICE.
 * Each inspection a field user opens leaves a `results-<id>` IndexedDB database
 * behind — the `y-indexeddb` mirror of its Yjs document, holding real CRDT
 * update payloads, not an empty shell — plus any photo/crop/annotation bytes
 * still queued for upload in `collab-media-pending`. Measured on a walkthrough
 * device: two databases for inspections the server had already deleted, ~10 KB
 * and ~11.7 KB, with five more surviving for other ids.
 *
 * `deleteResultsDb` already existed for the restore-resync path and had no
 * caller outside its own module. This is the retention path.
 *
 * ── WHAT THIS REACHES, AND WHAT IT DOES NOT ─────────────────────────────────
 *
 * This is device-local and best-effort, and it has to be read that way:
 *
 *  ✔ the browser profile that performed the deletion, for that inspection:
 *    its Yjs results database and its queued upload bytes.
 *
 *  ✘ every OTHER device or browser profile that ever opened that inspection.
 *    There is no push channel to them and no server-side record of which
 *    devices hold a copy; their copy survives until site data is cleared or
 *    (for the Yjs database) until something else calls this function there.
 *  ✘ a device that is offline when the deletion happens — including the one
 *    doing the deleting, if the list page is operating from cache.
 *  ✘ anything outside these two IndexedDB stores: an OS-level screenshot, a
 *    photo still in the camera roll, an HTTP cache entry.
 *
 * So this closes the common case (the inspector's own phone or laptop) and
 * narrows the exposure; it is NOT a guarantee that no copy of a deleted
 * inspection's field content remains on any device.
 *
 * Browser-only: every call is a no-op without `indexedDB` (SSR, or a profile
 * with site data blocked), and no failure here ever rejects — a cleanup that
 * throws would take down the caller's delete flow, which is the worse outcome.
 */
import { deleteResultsDb } from "./results-doc-connection";
import { listPendingMedia, deletePendingMedia } from "./media-pending-store";

export interface OfflinePurgeResult {
    /** Queued media records removed (photos, crops, annotations awaiting upload). */
    pendingMediaDeleted: number;
    /** False when there is no IndexedDB here at all, so nothing was even tried. */
    attempted: boolean;
}

const NOT_ATTEMPTED: OfflinePurgeResult = {
    pendingMediaDeleted: 0,
    attempted: false,
};

export async function purgeInspectionOfflineData(inspectionId: string): Promise<OfflinePurgeResult> {
    if (!inspectionId) return NOT_ATTEMPTED;
    if (typeof indexedDB === "undefined") return NOT_ATTEMPTED;

    // Queued media FIRST. Those are client-produced bytes that exist nowhere
    // else, so if only one of the two deletes gets to run, it should be this
    // one: the Yjs database is a mirror of a document the server just destroyed,
    // while a pending blob is the original.
    let pendingMediaDeleted = 0;
    const pending = await listPendingMedia(inspectionId);
    for (const record of pending) {
        // `deletePendingMedia` resolves on failure as well as success, so the
        // count is "rows we asked to remove", not "rows provably gone". Stated
        // rather than implied: a caller must not read it as a receipt.
        await deletePendingMedia(record.pendingId);
        pendingMediaDeleted += 1;
    }

    await deleteResultsDb(inspectionId);

    return { pendingMediaDeleted, attempted: true };
}
