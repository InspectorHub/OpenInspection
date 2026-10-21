/**
 * React hook — connects a browser Y.Doc to the InspectionDocDO.
 *
 * Thin wrapper around connectResultsDoc. All WebSocket/persistence construction
 * happens inside useEffect (client-only); returns null on the SSR pass.
 *
 * Lifecycle: re-initialises only when inspectionId changes.
 * Browser E2E coverage: Task 10 (not unit-tested here — no render harness).
 */

import { useState, useEffect, useRef } from 'react';
import { connectResultsDoc } from './results-doc-connection';
import type { ConnectOptions, ResultsDocHandle } from './results-doc-connection';

export type { ResultsDocHandle };

/**
 * The host-supplied pieces of a connection: persistence store, socket URL and
 * (optionally) the network-is-back signal. The web host is `webCollabHost` in
 * `app/lib/field/web-collab.ts`. Pass a stable reference (a module constant).
 */
export type ResultsDocHost = Pick<ConnectOptions, 'persistence' | 'wsUrl' | 'subscribeOnline'>;

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
    host: ResultsDocHost,
    onSynced?: () => void,
): ResultsDocHandle | null {
    const [handle, setHandle] = useState<ResultsDocHandle | null>(null);

    // Keep the latest onSynced without re-subscribing the connection.
    const onSyncedRef = useRef<(() => void) | undefined>(onSynced);
    onSyncedRef.current = onSynced;

    useEffect(() => {
        // No id → collab disabled; do not connect (hook yields null).
        if (!inspectionId) {
            setHandle(null);
            return;
        }

        const { handle: initial, destroy } = connectResultsDoc(inspectionId, {
            ...host,
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
    }, [inspectionId, host]);

    return handle;
}
