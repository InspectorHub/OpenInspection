/**
 * Remove a pending offline photo (`dropPendingPhoto`), or the pending marker of a crop or annotation
 * (`clearPendingDerivative`), from the results document once the host has permanently refused its bytes, so nothing stays
 * on "uploading" for a file that will never upload.
 *
 * A brand-new offline photo has an empty `key` that is not unique (two offline adds collide under a key match), so
 * the entry is addressed by its pending id. A no-op when no photo carries the id, which makes a repeated drop safe.
 *
 * Kept beside the drain rather than in `results-binding.ts` / `results-doc.ts`: both are at their size cap.
 */

import * as Y from 'yjs';

/**
 * Looked up READ-ONLY: dropping a photo of a finding that is not in the document must not create an empty item there,
 * because that write would sync to every peer and to the server.
 */
export function dropPendingPhoto(doc: Y.Doc, findingKey: string, pendingId: string): void {
    const item = doc.getMap<unknown>('results').get(findingKey);
    if (!(item instanceof Y.Map)) return;
    const photos = item.get('photos');
    if (!(photos instanceof Y.Array)) return;
    for (let i = 0; i < photos.length; i++) {
        const el = photos.get(i);
        if (el instanceof Y.Map && el.get('pendingId') === pendingId) {
            doc.transact(() => photos.delete(i, 1));
            return;
        }
    }
}

/**
 * Clear the pending marker a crop or an annotation left on its photo once the host has permanently refused the bytes,
 * so the photo stops showing a derivative that will never arrive. The photo, its keys and its other fields stay: the
 * original is untouched. Addressed by the base photo key AND the pending id, so a newer edit of the same photo (a
 * different pending id) keeps its marker. Looked up READ-ONLY, like `dropPendingPhoto`: an absent finding or photo
 * writes nothing, and a repeat is a no-op.
 */
export function clearPendingDerivative(doc: Y.Doc, findingKey: string, photoKey: string, pendingId: string): void {
    const item = doc.getMap<unknown>('results').get(findingKey);
    if (!(item instanceof Y.Map)) return;
    const photos = item.get('photos');
    if (!(photos instanceof Y.Array)) return;
    for (let i = 0; i < photos.length; i++) {
        const el = photos.get(i);
        if (el instanceof Y.Map && el.get('key') === photoKey && el.get('pendingId') === pendingId) {
            doc.transact(() => {
                // The nodes of an annotation that never became an image describe nothing; with an earlier annotated
                // image they stay, because the previous nodes cannot be recovered.
                if (el.get('pendingKind') === 'annotate' && !el.get('annotatedKey')) el.delete('annotationsJson');
                el.delete('pendingId');
                el.delete('pendingKind');
            });
            return;
        }
    }
}
