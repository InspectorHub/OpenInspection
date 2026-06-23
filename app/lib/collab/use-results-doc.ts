/**
 * React hook — connects a browser Y.Doc to the InspectionDocDO.
 *
 * Thin wrapper around connectResultsDoc. All WebSocket/IndexedDB construction
 * happens inside useEffect (client-only); returns null on the SSR pass.
 *
 * Lifecycle: re-initialises only when inspectionId changes.
 * Browser E2E coverage: Task 10 (not unit-tested here — no render harness).
 */

import { useState, useEffect } from 'react';
import { connectResultsDoc } from './results-doc-connection';
import type { ResultsDocHandle } from './results-doc-connection';

export type { ResultsDocHandle };

/**
 * Returns the live ResultsDocHandle once the client connection is established,
 * or null on the SSR pass / before the connection initialises.
 */
export function useResultsDoc(inspectionId: string): ResultsDocHandle | null {
    const [handle, setHandle] = useState<ResultsDocHandle | null>(null);

    useEffect(() => {
        // SSR guard — should not be reached in practice (useEffect is
        // browser-only), but defend against edge cases in test environments.
        if (typeof window === 'undefined') return;

        const { handle: initial, destroy } = connectResultsDoc(inspectionId, {
            onChange: (updated) => {
                // Spread so React sees a new object reference and re-renders.
                setHandle({ ...updated });
            },
        });

        // Expose the initial handle immediately (nothing synced yet).
        setHandle({ ...initial });

        return destroy;
    }, [inspectionId]);

    return handle;
}
