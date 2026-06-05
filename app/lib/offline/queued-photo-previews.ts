/**
 * Pure helpers for the `queuedPhotoPreviews` state map used in
 * inspection-edit.tsx.
 *
 * Shape: `itemId → Array<{ name: string; objectUrl: string }>`
 *
 * All helpers return a NEW map (immutable reducer style) so React sees the
 * state update.  Object-URL lifecycle (create / revoke) is the caller's
 * responsibility.
 */

export type QueuedPhotoPreview = { name: string; objectUrl: string };
export type QueuedPreviewMap = Record<string, QueuedPhotoPreview[]>;

/**
 * Append a preview entry for `itemId`.  Returns a new map.
 */
export function addQueuedPreview(
    map: QueuedPreviewMap,
    itemId: string,
    entry: QueuedPhotoPreview,
): QueuedPreviewMap {
    const existing = map[itemId] ?? [];
    return { ...map, [itemId]: [...existing, entry] };
}

/**
 * Remove all preview entries (e.g. after a successful replay).
 * Object URLs must be revoked by the caller before calling this.
 */
export function clearQueuedPreviews(): QueuedPreviewMap {
    return {};
}

/**
 * Collect all object URLs across every item in the map.
 * Used for bulk-revoke on unmount / clear.
 */
export function collectObjectUrls(map: QueuedPreviewMap): string[] {
    const urls: string[] = [];
    for (const previews of Object.values(map)) {
        for (const p of previews) {
            urls.push(p.objectUrl);
        }
    }
    return urls;
}
