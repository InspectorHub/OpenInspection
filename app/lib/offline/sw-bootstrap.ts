/**
 * sw-bootstrap — versioned service-worker registration with a kill switch.
 *
 * FE-1 escape hatch: set `?no-sw=1` in the URL or
 * `localStorage.setItem('oi:sw-disable', '1')` to immediately disable the SW.
 * The kill switch takes effect on the next page load; the SW is unregistered and
 * nothing is re-registered until the flag is removed.
 */
import { unregisterAllServiceWorkers, type SWContainerLike } from '../sw-cleanup';

/** Kill switch: '?no-sw=1' in the URL or localStorage 'oi:sw-disable' === '1'.
 *  FE-1 escape hatch — lets anyone rule the SW out in one reload. */
export function swKillSwitchActive(
    search: string,
    storage: Pick<Storage, 'getItem'>,
): boolean {
    try {
        const params = new URLSearchParams(search);
        if (params.get('no-sw') === '1') return true;
    } catch {
        /* malformed search string — not a kill switch */
    }
    try {
        if (storage.getItem('oi:sw-disable') === '1') return true;
    } catch {
        /* localStorage unavailable (private browsing / quota errors) */
    }
    return false;
}

export interface SWRegistrarLike extends SWContainerLike {
    register(url: string): Promise<unknown>;
}

/**
 * Boot policy:
 *   - `container` undefined → 'unavailable' (SSR, or browser without SW support)
 *   - Kill switch active → unregister everything, register nothing → 'disabled'
 *   - Otherwise → register '/sw.js' → 'registered'
 *     (the browser no-ops if the same script is already active, and swaps in the
 *     new version via the normal update flow when the file changes — no manual
 *     unregister needed for version bumps)
 *
 * Never throws. Returns what it did: 'disabled' | 'registered' | 'unavailable'.
 */
export async function bootstrapServiceWorker(
    container: SWRegistrarLike | undefined,
    search: string,
    storage: Pick<Storage, 'getItem'>,
): Promise<'disabled' | 'registered' | 'unavailable'> {
    if (!container) return 'unavailable';

    if (swKillSwitchActive(search, storage)) {
        // Zombie-exorcism behavior preserved under kill switch: any existing
        // registrations are torn down so the SW stops intercepting requests.
        await unregisterAllServiceWorkers(container);
        return 'disabled';
    }

    try {
        await container.register('/sw.js');
        return 'registered';
    } catch {
        // register() can throw if the SW script 404s, has a parse error, or if
        // the page is not served over HTTPS. Treat all of these as unavailable.
        return 'unavailable';
    }
}
