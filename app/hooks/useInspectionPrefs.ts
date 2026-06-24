import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { AutoAdvanceMode } from '~/lib/rating-levels';

export type RequireDefectFields = 'none' | 'location' | 'trade' | 'both';

export interface InspectionPrefs {
    cloneDefault:       'rating' | 'rating_notes' | 'all';
    /** B-18 — when rating an item advances to the next unrated one.
     *  'always' (default): satisfactory/non-pausing ratings advance on click or key; defect/monitor pause to write notes.
     *  'keyboard': only keyboard 1-5 speed-scanning advances; pointer clicks stay put.
     *  'off': never advances, always stays on the rated item. */
    autoAdvance:        AutoAdvanceMode;
    autoAdvanceDelayMs: number;
    pinnedTagIds:       string[];
    /** Track H (IA-7) — which defect fields the publish gate REQUIRES
     *  tenant-wide. 'none' (default) = gaps warn but never block. */
    requireDefectFields: RequireDefectFields;
}

const DEFAULTS: InspectionPrefs = {
    cloneDefault:       'rating_notes',
    autoAdvance:        'always',
    autoAdvanceDelayMs: 200,
    pinnedTagIds:       [],
    requireDefectFields: 'none',
};

/**
 * Workflow shortcuts PR — tenant inspection-editor preferences.
 * Track H (C-12): rides the BFF resource route `/resources/inspection-prefs`
 * via useFetcher (Token-Relay) instead of raw client fetches against
 * /api/tenant/inspection-prefs. Falls back to hard-coded defaults if the
 * load fails (offline, 401, etc).
 */
export function useInspectionPrefs() {
    const [prefs, setPrefs]   = useState<InspectionPrefs>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);
    const loadFetcher  = useFetcher<{ prefs: InspectionPrefs | null }>();
    const patchFetcher = useFetcher<{ ok: boolean; prefs: InspectionPrefs | null }>();
    const requested = useRef(false);

    useEffect(() => {
        if (requested.current) return;
        requested.current = true;
        loadFetcher.load('/resources/inspection-prefs');
        }, []);

    useEffect(() => {
        if (loadFetcher.state !== 'idle') return;
        if (!requested.current) return;
        if (loadFetcher.data !== undefined) {
            if (loadFetcher.data?.prefs) setPrefs(loadFetcher.data.prefs);
            setLoaded(true);
        }
    }, [loadFetcher.state, loadFetcher.data]);

    // B-17 lesson: re-submitting a shared fetcher CANCELS the in-flight
    // request. Two quick patches touching different fields would lose the
    // first one — so consecutive deltas accumulate and every submission
    // carries the union; the echo clears the accumulator.
    const pendingDelta = useRef<Partial<InspectionPrefs>>({});

    useEffect(() => {
        // Server echo after a PATCH — adopt the validated, merged result.
        if (patchFetcher.state === 'idle' && patchFetcher.data?.ok && patchFetcher.data.prefs) {
            setPrefs(patchFetcher.data.prefs);
            pendingDelta.current = {};
        }
    }, [patchFetcher.state, patchFetcher.data]);

    const patch = useCallback((delta: Partial<InspectionPrefs>) => {
        // Optimistic update; the fetcher effect adopts the server echo.
        setPrefs(prev => ({ ...prev, ...delta }));
        pendingDelta.current = { ...pendingDelta.current, ...delta };
        patchFetcher.submit(
            { patch: JSON.stringify(pendingDelta.current) },
            { method: 'post', action: '/resources/inspection-prefs' },
        );
    }, [patchFetcher]);

    return { prefs, loaded, patch };
}
