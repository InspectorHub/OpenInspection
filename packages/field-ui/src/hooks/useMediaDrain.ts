/**
 * #181 PR-G — offline media drain orchestration for the inspection editor.
 *
 * Wires the offline media-upload queue (media-upload-queue.ts) to the live
 * collab Y.Doc: the store and the uploader come from the data source
 * (`media.store`, `media.uploader`); this hook adds an `onUploaded` that swaps
 * the pending doc entry to its real key, then triggers `drainMediaQueue` on each
 * collab (re)sync and when the host reports the network is back. Idempotent — the
 * queue's own in-flight guard + empty-queue no-op make repeat triggers safe.
 *
 * The uploader resolves the photo index at DRAIN time from the doc it is given.
 */

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { drainMediaQueue } from '../collab/media-upload-queue';
import type { MediaUploader as DrainUploader, UploadResult } from '../collab/media-upload-queue';
import { resolvePendingPhoto } from '../collab/results-binding';
import { useFieldDataSource } from '../context';
import type { MediaUploader } from '../media-types';

/**
 * The drain's uploader rejects to leave a record queued; the data source's answers
 * `{ ok: false }` instead. This maps one onto the other: an ok answer carries the one
 * key the record's kind produces.
 */
function asDrainUploader(uploader: MediaUploader): DrainUploader {
    return {
        async upload(rec): Promise<UploadResult> {
            const out = await uploader.upload(rec);
            if (!out.ok) throw new Error(out.error);
            if (rec.kind === 'photo') return { key: out.key };
            return rec.kind === 'crop' ? { croppedKey: out.key } : { annotatedKey: out.key };
        },
    };
}

/**
 * Returns a stable `drain()` callback and auto-triggers it when the host reports the
 * network is back. The caller ALSO passes `drain` as the collab `onSynced` so a
 * reconnect drains the queue. No-op (collab off) when `doc` is null.
 */
export function useMediaDrain(
    inspectionId: string,
    doc: Y.Doc | null,
    revokePendingUrl?: (pendingId: string) => void,
): { drain: () => void } {
    const dataSource = useFieldDataSource();
    const docRef = useRef<Y.Doc | null>(doc);
    docRef.current = doc;
    const revokeRef = useRef(revokePendingUrl);
    revokeRef.current = revokePendingUrl;

    const drain = useCallback(() => {
        const liveDoc = docRef.current;
        if (!liveDoc) return;
        void drainMediaQueue({
            inspectionId,
            store: dataSource.media.store,
            uploader: asDrainUploader(dataSource.media.uploader(inspectionId, liveDoc)),
            onUploaded: (rec, result) => {
                // Swap the pending doc entry to the real key + clear pending fields.
                resolvePendingPhoto(
                    liveDoc,
                    rec.meta.findingKey,
                    rec.pendingId,
                    rec.kind,
                    rec.kind === 'photo' ? undefined : rec.meta.photoKey,
                    result,
                );
                revokeRef.current?.(rec.pendingId);
            },
            onCleanupFailed: (rec, error) => {
                // The photo is uploaded and swapped in; only the local copy stays until the next drain deletes it.
                console.error('Could not remove an uploaded photo from the local queue:', rec.pendingId, error);
            },
        });
    }, [dataSource, inspectionId]);

    // Drain when the network returns (in addition to the collab onSynced trigger).
    useEffect(
        () =>
            dataSource.onOnlineChange((online) => {
                if (online) drain();
            }),
        [dataSource, drain],
    );

    return { drain };
}
