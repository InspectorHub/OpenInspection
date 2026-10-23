import { useEffect, useState, useSyncExternalStore } from 'react';

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
 * A store subscription with a FIXED server snapshot ('desktop'), so the server render and the client's first
 * render agree and the client then moves to the real band. The `useState(() => matchMedia(...))` form read the
 * browser on the first client render and produced a hydration mismatch on every phone load.
 */
export function useEditorLayout(): EditorLayout {
    return useSyncExternalStore(subscribeLayout, readLayout, () => 'desktop');
}

/**
 * True while the viewport is at most `px` wide. A store subscription with a fixed `false` server snapshot, so the
 * server markup and the first client render agree before the client moves to the real answer.
 */
export function useMaxWidth(px: number): boolean {
    const query = `(max-width: ${px}px)`;
    return useSyncExternalStore(
        (onChange) => {
            if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {};
            const mq = window.matchMedia(query);
            mq.addEventListener('change', onChange);
            return () => mq.removeEventListener('change', onChange);
        },
        () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(query).matches,
        () => false,
    );
}
