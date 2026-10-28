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
    /** The last state the host acknowledged (the load, or a saved echo): the baseline a failed save falls back to. */
    const committed = useRef<InspectionPrefs>(DEFAULT_INSPECTION_PREFS);
    /**
     * What the page shows right now, kept in step with `prefs` SYNCHRONOUSLY. A change computed from the
     * rendered `prefs` is stale when two land before the next render (a list edited by several quick clicks
     * would lose all but the last); `patch` can be given a function of this value instead.
     */
    const latest = useRef<InspectionPrefs>(DEFAULT_INSPECTION_PREFS);
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
                committed.current = loadedPrefs;
                if (!mounted.current) return;
                latest.current = loadedPrefs;
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

    // Saves are SERIALISED: one request in flight, and every change made meanwhile accumulates in `queued` and
    // goes out as ONE request when the in-flight one settles. Concurrent requests could land out of order on
    // the server (an older delta applied last, losing the newer value) and could not be told apart on failure.
    // `committed` is the last state the host acknowledged; a failed request puts back ONLY the keys that
    // request carried (and only those not edited again since), taken from `committed`, so a value that did
    // save is never rolled back with one that did not.
    const queued = useRef<Partial<InspectionPrefs>>({});
    const pumping = useRef(false);
    const [saveFailed, setSaveFailed] = useState(false);

    const pump = useCallback(async (store: NonNullable<typeof prefsStore>) => {
        pumping.current = true;
        try {
            while (Object.keys(queued.current).length > 0) {
                const sent = queued.current;
                queued.current = {};
                const result = await store.patch(sent).then(
                    (r) => r,
                    (): { ok: false; data?: undefined } => ({ ok: false }),
                );
                if (result.ok) {
                    // Adopt the host's validated, merged answer; without one, the delta itself is now saved.
                    committed.current = result.data ?? { ...committed.current, ...sent };
                    if (mounted.current) {
                        const later = queued.current;
                        const base = committed.current;
                        latest.current = { ...base, ...later };
                        setPrefs(latest.current);
                    }
                } else {
                    // The optimistic values of THIS request would otherwise stand, nothing would say anything,
                    // and the control would keep showing a value that had just failed to save. On a page of
                    // workspace-wide editor defaults that means an operator walks away believing they changed
                    // how every inspector's editor behaves.
                    const back: Partial<Record<keyof InspectionPrefs, unknown>> = {};
                    for (const key of Object.keys(sent) as Array<keyof InspectionPrefs>) {
                        if (!(key in queued.current)) back[key] = committed.current[key];
                    }
                    if (mounted.current) {
                        latest.current = { ...latest.current, ...(back as Partial<InspectionPrefs>) };
                        setPrefs(latest.current);
                        setSaveFailed(true);
                    }
                }
            }
        } finally {
            pumping.current = false;
            if (mounted.current) setSaving(false);
        }
    }, []);

    const patch = useCallback((change: Partial<InspectionPrefs> | ((current: InspectionPrefs) => Partial<InspectionPrefs>)) => {
        // A function sees the value of every change already made, rendered or not, so toggling one entry of a list
        // several times in a row applies each toggle to the result of the last.
        const delta = typeof change === 'function' ? change(latest.current) : change;
        if (Object.keys(delta).length === 0) return;
        // Optimistic update; the answer adopts the server echo.
        latest.current = { ...latest.current, ...delta };
        setPrefs(latest.current);
        setSaveFailed(false);
        if (!prefsStore) return;
        queued.current = { ...queued.current, ...delta };
        if (pumping.current) return;
        setSaving(true);
        // `pumping` is set synchronously inside `pump`, before its first await, so a second call in the same
        // frame only queues.
        void pump(prefsStore);
    }, [prefsStore, pump]);

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
