/**
 * Offline photo batch: persist each baked photo in the host's local media store and append its pending doc entry.
 *
 * The host's store may reject a file (unsupported type, too large, blocked, write failure). The rejection is opaque
 * here, because the contract of `PendingMediaStore.put` carries no user-safe text; the file is skipped, the rest of
 * the batch still goes through, and the caller gets the count to announce once. A rejected file never gets a doc
 * entry, so no pending photo points at bytes that were not stored.
 *
 * No React imports.
 */

import type * as Y from 'yjs';
import type { PendingMediaStore } from '../media-types';
import { enqueueMedia } from './media-upload-queue';
import { appendPendingPhoto } from './results-binding';

export interface OfflinePhotoTarget {
    inspectionId: string;
    findingKey:   string;
    itemId:       string;
}

export type OfflinePhotoRejectionReason = 'unsupportedType' | 'tooLarge';

export interface OfflinePhotoBatchResult {
    rejected: number;
    /** Counts for known, safe storage error codes. Unknown errors remain in `rejected` only. */
    reasons: Partial<Record<OfflinePhotoRejectionReason, number>>;
}

function safeRejectionReason(error: unknown): OfflinePhotoRejectionReason | undefined {
    if (!error || typeof error !== 'object') return undefined;
    try {
        switch (Reflect.get(error, 'code')) {
            case 'UNSUPPORTED_TYPE': return 'unsupportedType';
            case 'TOO_LARGE': return 'tooLarge';
            default: return undefined;
        }
    } catch {
        return undefined;
    }
}

/**
 * Store and append every file in order; resolves to the rejection count and safe coded reasons. Never rejects. A file counts as rejected
 * when the store refuses it OR when the doc entry cannot be appended after the bytes were stored; in the second case
 * the stored row is removed again on a best-effort basis, so no bytes are left without an entry.
 */
export async function addOfflinePhotos(
    store: PendingMediaStore,
    doc: Y.Doc,
    target: OfflinePhotoTarget,
    files: readonly Blob[],
): Promise<OfflinePhotoBatchResult> {
    let rejected = 0;
    const reasons: OfflinePhotoBatchResult['reasons'] = {};
    for (const blob of files) {
        const pendingId = crypto.randomUUID();
        let stored = false;
        try {
            await enqueueMedia(store, {
                pendingId,
                inspectionId: target.inspectionId,
                kind: 'photo',
                blob,
                meta: { targetType: 'item', findingKey: target.findingKey, itemId: target.itemId },
                createdAt: Date.now(),
            });
            stored = true;
            appendPendingPhoto(doc, target.findingKey, pendingId);
        } catch (error) {
            rejected += 1;
            const reason = safeRejectionReason(error);
            if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
            if (stored) await Promise.resolve().then(() => store.delete(pendingId)).catch(() => undefined);
        }
    }
    return { rejected, reasons };
}
