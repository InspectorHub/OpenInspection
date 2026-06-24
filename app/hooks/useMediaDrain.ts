/**
 * #181 PR-G — offline media drain orchestration for the inspection editor.
 *
 * Wires the offline media-upload queue (media-upload-queue.ts) to the live
 * collab Y.Doc: builds a `MediaUploader` (POST by kind to the existing R2/crop/
 * annotation endpoints) + an `onUploaded` that swaps the pending doc entry to its
 * real key, then triggers `drainMediaQueue` on each collab (re)sync and on the
 * browser `online` event. Idempotent — the queue's own in-flight guard +
 * empty-queue no-op make repeat triggers safe.
 *
 * The crop/annotate endpoints address by photoIndex, but indices shift as photos
 * are added/removed. The uploader therefore resolves the CURRENT index from the
 * doc's live photo array by the record's `photoKey` AT DRAIN TIME (not at enqueue
 * time). If the base photo has since been deleted, the upload throws and the
 * record stays queued (it will be retried on the next drain, and ultimately the
 * orphaned base never returning means it stays pending — acceptable: nothing to
 * derive from).
 */

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import {
    drainMediaQueue,
    type MediaUploader,
    type UploadResult,
} from '~/lib/collab/media-upload-queue';
import type { PendingMediaRecord } from '~/lib/collab/media-pending-store';
import { resolvePendingPhoto } from '~/lib/collab/results-binding';
import { readResultMap } from '~/lib/collab/results-binding';
import type { PhotoEntry } from '../../server/lib/collab/results-doc.types';

/** Resolve the CURRENT index of `photoKey` in the doc's photo array for `fk`. */
function currentPhotoIndex(doc: Y.Doc, findingKey: string, photoKey: string): number {
    const entry = readResultMap(doc)[findingKey];
    const photos = (entry?.photos as PhotoEntry[] | undefined) ?? [];
    return photos.findIndex((p) => p.key === photoKey);
}

/**
 * Build a MediaUploader that POSTs each pending record to the right endpoint by
 * kind. The crop/annotate endpoints take the CURRENT photoIndex resolved from
 * the live doc. The server skips the legacy results.data write under collab
 * (skipResultsWrite is derived server-side), so the doc swap below is the only
 * write of the derivative into the results.
 */
function buildUploader(inspectionId: string, doc: Y.Doc): MediaUploader {
    return {
        async upload(rec: PendingMediaRecord): Promise<UploadResult> {
            if (rec.kind === 'photo') {
                const fd = new FormData();
                fd.append('file', new File([rec.blob], 'photo.jpg', { type: rec.blob.type || 'image/jpeg' }));
                fd.append('itemId', itemIdFromFindingKey(rec.findingKey));
                const res = await fetch(`/api/inspections/${inspectionId}/upload`, {
                    method: 'POST',
                    credentials: 'include',
                    body: fd,
                });
                if (!res.ok) throw new Error(`upload failed: ${res.status}`);
                const body = (await res.json().catch(() => null)) as { data?: { key?: string } } | null;
                const key = body?.data?.key;
                if (!key) throw new Error('upload returned no key');
                return { key };
            }

            // crop / annotate: resolve the CURRENT photo index by base key.
            if (!rec.photoKey) throw new Error('derivative record missing photoKey');
            const index = currentPhotoIndex(doc, rec.findingKey, rec.photoKey);
            if (index < 0) throw new Error('base photo no longer present');
            const itemId = itemIdFromFindingKey(rec.findingKey);
            const sectionId = sectionIdFromFindingKey(rec.findingKey);

            if (rec.kind === 'crop') {
                const fd = new FormData();
                fd.append('image', new File([rec.blob], 'cropped.jpg', { type: 'image/jpeg' }));
                fd.append('crop', JSON.stringify(rec.crop ?? {}));
                if (sectionId) fd.append('sectionId', sectionId);
                const res = await fetch(
                    `/api/inspections/${inspectionId}/items/${itemId}/photos/${index}/crop`,
                    { method: 'POST', credentials: 'include', body: fd },
                );
                if (!res.ok) throw new Error(`crop failed: ${res.status}`);
                const body = (await res.json().catch(() => null)) as { data?: { croppedKey?: string } } | null;
                const croppedKey = body?.data?.croppedKey;
                if (!croppedKey) throw new Error('crop returned no croppedKey');
                return { croppedKey };
            }

            // annotate
            const fd = new FormData();
            fd.append('image', new File([rec.blob], 'annotated.png', { type: 'image/png' }));
            fd.append('nodes', rec.nodesJson ?? '');
            if (sectionId) fd.append('sectionId', sectionId);
            const res = await fetch(
                `/api/inspections/${inspectionId}/items/${itemId}/photos/${index}/annotation`,
                { method: 'POST', credentials: 'include', body: fd },
            );
            if (!res.ok) throw new Error(`annotation failed: ${res.status}`);
            const body = (await res.json().catch(() => null)) as { data?: { annotatedKey?: string } } | null;
            const annotatedKey = body?.data?.annotatedKey;
            if (!annotatedKey) throw new Error('annotation returned no annotatedKey');
            return { annotatedKey };
        },
    };
}

/** Composite finding key format: `_default:{sectionId}:{itemId}`. */
function itemIdFromFindingKey(findingKey: string): string {
    const parts = findingKey.split(':');
    return parts[parts.length - 1] ?? findingKey;
}

function sectionIdFromFindingKey(findingKey: string): string | undefined {
    const parts = findingKey.split(':');
    return parts.length >= 3 ? parts[parts.length - 2] : undefined;
}

/**
 * Returns a stable `drain()` callback and auto-triggers it on the browser
 * `online` event. The caller ALSO passes `drain` as the collab `onSynced` so a
 * reconnect drains the queue. No-op (collab off) when `doc` is null.
 */
export function useMediaDrain(
    inspectionId: string,
    doc: Y.Doc | null,
    revokePendingUrl?: (pendingId: string) => void,
): { drain: () => void } {
    const docRef = useRef<Y.Doc | null>(doc);
    docRef.current = doc;
    const revokeRef = useRef(revokePendingUrl);
    revokeRef.current = revokePendingUrl;

    const drain = useCallback(() => {
        const liveDoc = docRef.current;
        if (!liveDoc) return;
        const uploader = buildUploader(inspectionId, liveDoc);
        void drainMediaQueue({
            inspectionId,
            uploader,
            onUploaded: (rec, result) => {
                // Swap the pending doc entry to the real key + clear pending fields.
                resolvePendingPhoto(
                    liveDoc,
                    rec.findingKey,
                    rec.pendingId,
                    rec.kind,
                    rec.photoKey,
                    result,
                );
                revokeRef.current?.(rec.pendingId);
            },
        });
    }, [inspectionId]);

    // Drain when the network returns (in addition to the collab onSynced trigger).
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onOnline = (): void => drain();
        window.addEventListener('online', onOnline);
        return () => window.removeEventListener('online', onOnline);
    }, [drain]);

    return { drain };
}
