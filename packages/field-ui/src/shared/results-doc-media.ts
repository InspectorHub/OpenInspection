import * as Y from 'yjs';

/**
 * Remove a media entry that has no R2 `key` (a video: Stream keeps the bytes) from a
 * finding's photo array, by the identity it does have, `streamUid` or `mediaId`.
 *
 * A removal by `key` would match any keyless entry, so videos are never addressed that
 * way. Removes the first match only. No-op when the finding, the array or the entry is
 * absent (it never seeds anything).
 */
export function removeMediaBy(
    doc: Y.Doc,
    findingKey: string,
    identityField: 'streamUid' | 'mediaId',
    value: string,
): void {
    const item = doc.getMap<unknown>('results').get(findingKey);
    if (!(item instanceof Y.Map)) return;
    const photos = item.get('photos');
    if (!(photos instanceof Y.Array)) return;
    doc.transact(() => {
        for (let i = 0; i < photos.length; i++) {
            const el = photos.get(i);
            if (el instanceof Y.Map && el.get(identityField) === value) {
                photos.delete(i, 1);
                return;
            }
        }
    });
}
