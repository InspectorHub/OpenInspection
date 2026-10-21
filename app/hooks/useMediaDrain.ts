/**
 * #181 PR-G — offline media drain orchestration for the inspection editor.
 *
 * Wires the offline media-upload queue (media-upload-queue.ts) to the live
 * collab Y.Doc: the web store (`webMediaStore`) and the web uploader
 * (`createWebUploader`, same-origin BFF) are built in `app/lib/field/`; this hook
 * adds an `onUploaded` that swaps the pending doc entry to its real key, then
 * triggers `drainMediaQueue` on each collab (re)sync and on the browser `online`
 * event. Idempotent — the queue's own in-flight guard + empty-queue no-op make
 * repeat triggers safe.
 *
 * The uploader resolves the photo index at DRAIN time (see web-uploader.ts).
 */

import { useCallback, useEffect, useRef } from 'react';
import type * as Y from 'yjs';
import { drainMediaQueue } from '@core/field-ui/collab/media-upload-queue';
import { resolvePendingPhoto } from '@core/field-ui/collab/results-binding';
import { webMediaStore } from '~/lib/field/web-media-store';
import { createWebUploader } from '~/lib/field/web-uploader';

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
        void drainMediaQueue({
            inspectionId,
            store: webMediaStore,
            uploader: createWebUploader(inspectionId, liveDoc),
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
