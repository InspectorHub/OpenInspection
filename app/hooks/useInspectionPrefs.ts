import { useCallback, useEffect, useState } from 'react';

export interface InspectionPrefs {
    cloneDefault:       'rating' | 'rating_notes' | 'all';
    autoAdvanceDelayMs: number;
    pinnedTagIds:       string[];
}

const DEFAULTS: InspectionPrefs = {
    cloneDefault:       'rating_notes',
    autoAdvanceDelayMs: 200,
    pinnedTagIds:       [],
};

/**
 * Workflow shortcuts PR — loads tenant inspection-editor preferences from
 * /api/tenant/inspection-prefs and exposes an optimistic PATCH helper.
 * Falls back to hard-coded defaults if the fetch fails (offline, 404, etc).
 */
export function useInspectionPrefs() {
    const [prefs, setPrefs]   = useState<InspectionPrefs>(DEFAULTS);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        (async () => {
            try {
                const res = await fetch('/api/tenant/inspection-prefs', { credentials: 'include' });
                if (res.ok) {
                    const data = await res.json() as InspectionPrefs;
                    setPrefs(data);
                }
            } catch {
                /* keep defaults */
            } finally {
                setLoaded(true);
            }
        })();
    }, []);

    const patch = useCallback(async (delta: Partial<InspectionPrefs>) => {
        // Optimistic update.
        setPrefs(prev => ({ ...prev, ...delta }));
        try {
            const res = await fetch('/api/tenant/inspection-prefs', {
                method: 'PATCH',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(delta),
            });
            if (res.ok) {
                const updated = await res.json() as InspectionPrefs;
                setPrefs(updated);
            }
        } catch {
            /* keep optimistic value */
        }
    }, []);

    return { prefs, loaded, patch };
}
