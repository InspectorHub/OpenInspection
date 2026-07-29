import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetcher } from 'react-router';
import type { AutoAdvanceMode } from '~/lib/rating-levels';
import type { ReportLinkTtl } from '../../server/lib/report-link-ttl';

type RequireDefectFields = 'none' | 'location' | 'trade' | 'both';

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
    /** IA-35 / IA-73 — tenant policy for agent access to the repair list.
     *  'readwrite' (default) = agents may view and edit. */
    agentRepairAccess: 'off' | 'read' | 'readwrite';
    /** IA-36 ⑤ — how long a newly minted report link stays usable.
     *  'never' (default) = open-ended, the shipped behaviour. Mirrors
     *  `InspectionPrefsSchema` (server/lib/validations/inspection-prefs.schema.ts). */
    reportLinkTtl: ReportLinkTtl;
}

const DEFAULTS: InspectionPrefs = {
    cloneDefault:       'rating_notes',
    autoAdvance:        'always',
    autoAdvanceDelayMs: 200,
    pinnedTagIds:       [],
    requireDefectFields: 'none',
    agentRepairAccess: 'readwrite',
    reportLinkTtl: 'never',
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

    // IA-129 — the value to fall back to if the save fails. Captured at the
    // moment of the optimistic update, because by the time the failure arrives
    // `prefs` already contains the change we need to undo.
    const rollbackTo = useRef<InspectionPrefs | null>(null);
    const [saveFailed, setSaveFailed] = useState(false);

    // The other half of the echo effect above: a PATCH that comes back NOT ok.
    // There was no such branch — the optimistic `setPrefs` stood, nothing said
    // anything, and the control kept showing the value that had just failed to
    // save. On a page of workspace-wide editor defaults that means an operator
    // walks away believing they changed how every inspector's editor behaves.
    // Silence is the wrong answer twice over: it also means the page has no
    // vocabulary for success, so there was nothing to contrast a failure with.
    useEffect(() => {
        if (patchFetcher.state !== 'idle') return;
        if (patchFetcher.data && patchFetcher.data.ok === false) {
            if (rollbackTo.current) setPrefs(rollbackTo.current);
            rollbackTo.current = null;
            pendingDelta.current = {};
            setSaveFailed(true);
        }
    }, [patchFetcher.state, patchFetcher.data]);

    const patch = useCallback((delta: Partial<InspectionPrefs>) => {
        // Optimistic update; the fetcher effect adopts the server echo.
        setPrefs(prev => {
            // Remember the pre-change state for the rollback above. Only the
            // FIRST pending change records it, so a burst of edits rolls back to
            // where the burst started rather than to its second-to-last step.
            if (!rollbackTo.current) rollbackTo.current = prev;
            return { ...prev, ...delta };
        });
        setSaveFailed(false);
        pendingDelta.current = { ...pendingDelta.current, ...delta };
        patchFetcher.submit(
            { patch: JSON.stringify(pendingDelta.current) },
            { method: 'post', action: '/resources/inspection-prefs' },
        );
    }, [patchFetcher]);

    return {
        prefs,
        loaded,
        patch,
        /** IA-129 — true when the last save came back not-ok and `prefs` has been
         *  rolled back. Callers must surface this; a silent revert is its own
         *  small lie. */
        saveFailed,
        /** IA-129 — a save is in flight. Lets a caller say "saving…" so that
         *  "saved" and "failed" are not the page's only two silent states. */
        saving: patchFetcher.state !== 'idle',
    };
}
