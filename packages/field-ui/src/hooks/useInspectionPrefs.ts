import { useCallback, useEffect, useRef, useState } from 'react';
import { useFieldDataSource } from '../context';
import type { InspectionPrefs } from '../data-source-types';

export type { InspectionPrefs };

/** What the editor behaves like until the tenant's own preferences arrive (or when the host has no preference store). */
export const DEFAULT_INSPECTION_PREFS: InspectionPrefs = {
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
 * Reads and saves through `FieldDataSource.resources.prefs` (the web host rides the BFF
 * resource route `/resources/inspection-prefs`). Falls back to hard-coded defaults if the
 * load fails (offline, 401, etc), and uses them as the answer when the host has no
 * preference store at all.
 */
export function useInspectionPrefs() {
    const prefsStore = useFieldDataSource().resources.prefs;
    const [prefs, setPrefs]   = useState<InspectionPrefs>(DEFAULT_INSPECTION_PREFS);
    const [loaded, setLoaded] = useState(false);
    const [saving, setSaving] = useState(false);
    const requested = useRef(false);
    const mounted = useRef(true);
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);

    useEffect(() => {
        if (requested.current) return;
        requested.current = true;
        if (!prefsStore) {
            // No store: the defaults ARE the answer, so there is nothing left to wait for.
            setLoaded(true);
            return;
        }
        void prefsStore.load().then(
            (loadedPrefs) => {
                if (!mounted.current) return;
                setPrefs(loadedPrefs);
                setLoaded(true);
            },
            () => {
                // A failed load keeps the defaults, exactly as the old route did when it answered no prefs.
                if (mounted.current) setLoaded(true);
            },
        );
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one request per mount; the guard ref makes a changed store a no-op
    }, []);

    // B-17 lesson: a newer save supersedes an in-flight one, so consecutive deltas
    // accumulate and every request carries the union; only the answer to the LATEST
    // request is applied (the older one used to be aborted by the router and never
    // delivered); the echo clears the accumulator.
    const pendingDelta = useRef<Partial<InspectionPrefs>>({});
    const latestRequest = useRef(0);

    // IA-129 — the value to fall back to if the save fails. Captured at the
    // moment of the optimistic update, because by the time the failure arrives
    // `prefs` already contains the change we need to undo.
    const rollbackTo = useRef<InspectionPrefs | null>(null);
    const [saveFailed, setSaveFailed] = useState(false);

    const patch = useCallback((delta: Partial<InspectionPrefs>) => {
        // Optimistic update; the answer adopts the server echo.
        setPrefs(prev => {
            // Remember the pre-change state for the rollback. Only the
            // FIRST pending change records it, so a burst of edits rolls back to
            // where the burst started rather than to its second-to-last step.
            if (!rollbackTo.current) rollbackTo.current = prev;
            return { ...prev, ...delta };
        });
        setSaveFailed(false);
        pendingDelta.current = { ...pendingDelta.current, ...delta };
        if (!prefsStore) return;
        const request = ++latestRequest.current;
        setSaving(true);
        // A repeat is harmless: the PATCH carries the accumulated delta, which the server merges into the same row,
        // and a newer call supersedes this one's answer via latestRequest.
        void prefsStore.patch(pendingDelta.current).then(
            (result) => result,
            (): { ok: false; data?: undefined } => ({ ok: false }),
        ).then((result) => {
            if (!mounted.current || request !== latestRequest.current) return;
            setSaving(false);
            if (result.ok && result.data) {
                // Server echo after a PATCH — adopt the validated, merged result.
                setPrefs(result.data);
                rollbackTo.current = null;
                pendingDelta.current = {};
            } else if (!result.ok) {
                // A PATCH that comes back NOT ok. The optimistic `setPrefs` would otherwise stand, nothing
                // would say anything, and the control would keep showing the value that had just failed to
                // save. On a page of workspace-wide editor defaults that means an operator walks away
                // believing they changed how every inspector's editor behaves.
                if (rollbackTo.current) setPrefs(rollbackTo.current);
                rollbackTo.current = null;
                pendingDelta.current = {};
                setSaveFailed(true);
            }
        });
    }, [prefsStore]);

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
        saving,
    };
}
