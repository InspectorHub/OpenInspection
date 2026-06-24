/**
 * React hook — connects a browser Y.Doc to the InspectionDocDO.
 *
 * Thin wrapper around connectResultsDoc. All WebSocket/IndexedDB construction
 * happens inside useEffect (client-only); returns null on the SSR pass.
 *
 * Lifecycle: re-initialises only when inspectionId changes.
 * Browser E2E coverage: Task 10 (not unit-tested here — no render harness).
 */

import { useState, useEffect, useRef } from 'react';
import { connectResultsDoc } from './results-doc-connection';
import type { ResultsDocHandle } from './results-doc-connection';

export type { ResultsDocHandle };

/**
 * Returns the live ResultsDocHandle once the client connection is established,
 * or null on the SSR pass / before the connection initialises.
 *
 * Accepts `string | null`: when `inspectionId` is null/empty the effect returns
 * early and the hook yields `null` (no connection). This lets the editor call
 * it unconditionally (rules of hooks) while only connecting when collab is on.
 *
 * `onSynced` (optional) is invoked each time the collab socket (re)syncs with the
 * DO — the editor passes a media-queue drain trigger. It is held in a ref so a
 * changing callback identity never re-creates the connection (the effect only
 * re-runs on `inspectionId`).
 */
export function useResultsDoc(
    inspectionId: string | null,
    onSynced?: () => void,
): ResultsDocHandle | null {
    const [handle, setHandle] = useState<ResultsDocHandle | null>(null);

    // Keep the latest onSynced without re-subscribing the connection.
    const onSyncedRef = useRef<(() => void) | undefined>(onSynced);
    onSyncedRef.current = onSynced;

    useEffect(() => {
        // SSR guard — should not be reached in practice (useEffect is
        // browser-only), but defend against edge cases in test environments.
        if (typeof window === 'undefined') return;

        // No id → collab disabled; do not connect (hook yields null).
        if (!inspectionId) {
            setHandle(null);
            return;
        }

        const { handle: initial, destroy } = connectResultsDoc(inspectionId, {
            onChange: (updated) => {
                // Spread so React sees a new object reference and re-renders.
                setHandle({ ...updated });
            },
            onSynced: () => {
                onSyncedRef.current?.();
            },
        });

        // Expose the initial handle immediately (nothing synced yet).
        setHandle({ ...initial });

        return destroy;
    }, [inspectionId]);

    return handle;
}
