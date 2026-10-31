/**
 * Remove a pending offline photo from the results document once the host has permanently refused its bytes, so no
 * tile stays on "uploading" for a file that will never upload.
 *
 * A brand-new offline photo has an empty `key` that is not unique (two offline adds collide under a key match), so
 * the entry is addressed by its pending id. A no-op when no photo carries the id, which makes a repeated drop safe.
 *
 * Kept beside the drain rather than in `results-binding.ts` / `results-doc.ts`: both are at their size cap.
 */

import type * as Y from 'yjs';
import { getOrCreateArray, getOrSeedItem, removeElement } from '../shared/results-doc';

export function dropPendingPhoto(doc: Y.Doc, findingKey: string, pendingId: string): void {
    const results = doc.getMap<unknown>('results');
    doc.transact(() => {
        const item = getOrSeedItem(results, findingKey);
        removeElement(getOrCreateArray(item, 'photos'), 'pendingId', pendingId);
    });
}
