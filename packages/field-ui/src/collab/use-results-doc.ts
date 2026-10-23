/**
 * React hook — connects a browser Y.Doc to the InspectionDocDO.
 *
 * Thin wrapper around the data source's `collab` connector (which wraps
 * connectResultsDoc). All WebSocket/persistence construction happens inside
 * useEffect (client-only); returns null on the SSR pass.
 *
 * Lifecycle: re-initialises only when inspectionId changes.
 * Unit tests: use-results-doc.test.tsx (fake connector); the real socket is covered by the browser E2E.
 */

import { useState, useEffect, useRef } from 'react';
import { useFieldDataSource } from '../context';
import type { ConnectOptions, ResultsDocHandle } from './results-doc-connection';

export type { ResultsDocHandle };

/**
 * The host-supplied pieces of a connection: persistence store, socket URL and
 * (optionally) the network-is-back signal. A host turns these into its
 * `FieldDataSource.collab` connector (the web host does it in
 * `app/lib/field/web-data-source.ts`, from `webCollabHost` in `app/lib/field/web-collab.ts`).
 * Pass a stable reference (a module constant).
 */
export type ResultsDocHost = Pick<ConnectOptions, 'persistence' | 'wsUrl' | 'subscribeOnline'>;

/**
 * Returns the live ResultsDocHandle once the client connection is established,
 * or null on the SSR pass / before the connection initialises.
 *
 * The connection is the data source's `collab` connector. Its handle is a live
 * object (`doc` is replaced by a version restore, `synced()` is read on demand);
 * this hook republishes a fresh plain snapshot each time the connector reports a
 * change, so React sees a new reference and re-renders.
 *
 * Accepts `string | null`: when `inspectionId` is null/empty the effect returns
 * early and the hook yields `null` (no connection). This lets the editor call
 * it unconditionally (rules of hooks) while only connecting when collab is on.
 *
 * `onSynced` (optional) is invoked each time the collab socket (re)syncs with the
 * DO — the editor passes a media-queue drain trigger. It is held in a ref so a
 * changing callback identity never re-creates the connection (the effect only
 * re-runs on `inspectionId` or a different data source).
 */
export function useResultsDoc(inspectionId: string | null, onSynced?: () => void): ResultsDocHandle | null {
    const { collab } = useFieldDataSource();
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

        let persisted = false;
        let live: ReturnType<typeof collab.connect> | null = null;
        let closed = false;
        const snapshot = (): ResultsDocHandle | null =>
            live === null ? null : { doc: live.doc, persistenceSynced: persisted, synced: live.synced() };
        const publish = (): void => {
            if (closed) return;
            const next = snapshot();
            if (next !== null) setHandle(next);
        };

        live = collab.connect(inspectionId, {
            onChange: publish,
            onSynced: () => {
                onSyncedRef.current?.();
            },
        });
        // A store that fails to open never settles the promise, as before: the flag just stays false.
        void live.persistenceSynced.then(
            () => {
                persisted = true;
                publish();
            },
            () => undefined,
        );

        // Expose the initial handle immediately (nothing synced yet).
        publish();

        return () => {
            closed = true;
            live?.destroy();
        };
    }, [inspectionId, collab]);

    return handle;
}
