import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

/**
 * Returns true when viewport is below the Tailwind `md` breakpoint (768px).
 * Uses matchMedia for efficient subscription; re-renders on viewport changes.
 */
export function useIsMobile(): boolean {
    const [isMobile, setIsMobile] = useState(() => {
        if (typeof window === 'undefined') return false;
        return window.matchMedia('(max-width: 767.98px)').matches;
    });
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const mq = window.matchMedia('(max-width: 767.98px)');
        const fn = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', fn);
        return () => mq.removeEventListener('change', fn);
    }, []);
    return isMobile;
}

export type EditorLayout = 'phone' | 'tablet' | 'desktop';

const PHONE_QUERY = '(max-width: 767.98px)';
const TABLET_QUERY = '(max-width: 1023.98px)';

function readLayout(): EditorLayout {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return 'desktop';
    if (window.matchMedia(PHONE_QUERY).matches) return 'phone';
    if (window.matchMedia(TABLET_QUERY).matches) return 'tablet';
    return 'desktop';
}

function subscribeLayout(onChange: () => void): () => void {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
    const queries = [window.matchMedia(PHONE_QUERY), window.matchMedia(TABLET_QUERY)];
    for (const mq of queries) mq.addEventListener('change', onChange);
    return () => { for (const mq of queries) mq.removeEventListener('change', onChange); };
}

/**
 * The editor's layout band: phone (< 768), tablet (768-1023), desktop (>= 1024), decided by width alone.
 *
 * A store subscription whose server snapshot is FIXED for a given host answer (`initialLayout`, 'desktop' when the
 * host knows nothing), so the server render and the client's first render agree and the client then moves to the
 * real band. The `useState(() => matchMedia(...))` form read the browser on the first client render and produced a
 * hydration mismatch on every phone load.
 *
 * `initialLayout` is the band the host remembered from this device's last visit (the web host keeps it in a
 * cookie the server can read). With it a phone is server-rendered and hydrated as a phone instead of mounting the
 * desktop tree first and swapping it; matchMedia still has the last word, so a wrong memory is corrected right after
 * mount.
 *
 * `onObserved` is told the band the browser really shows: once after mount, then on every change. It is how a host
 * learns what to remember; it is not called while rendering.
 */
export function useEditorLayout(initialLayout: EditorLayout = 'desktop', onObserved?: (layout: EditorLayout) => void): EditorLayout {
    const serverSnapshot = useCallback(() => initialLayout, [initialLayout]);
    const layout = useSyncExternalStore(subscribeLayout, readLayout, serverSnapshot);
    const observer = useRef(onObserved);
    observer.current = onObserved;
    const told = useRef<EditorLayout | null>(null);
    useEffect(() => {
        // Read the browser, not `layout`: on the first commit `layout` is still the host's remembered band.
        const seen = readLayout();
        if (told.current === seen) return;
        told.current = seen;
        observer.current?.(seen);
    }, [layout]);
    return layout;
}

/**
 * True while the viewport is at most `px` wide. A store subscription with a fixed `false` server snapshot, so the
 * server markup and the first client render agree before the client moves to the real answer.
 */
export function useMaxWidth(px: number): boolean {
    const query = `(max-width: ${px}px)`;
    // Stable per query: a new `subscribe` identity on every render makes the store unsubscribe and resubscribe
    // on each render of the caller (the editor re-renders on every keystroke).
    const subscribe = useCallback(
        (onChange: () => void) => {
            if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
            const mq = window.matchMedia(query);
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        },
        [query],
    );
    const getSnapshot = useCallback(
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
        [query],
    );
    return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
