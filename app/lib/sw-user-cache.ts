/**
 * sw-user-cache: tells the service worker who is signed in, so its per-user offline cache is never
 * shown to anyone else on the same browser (public/sw.js owns the cache; this is the page's half).
 *
 * Everything here is best effort and never throws: a missing service worker (SSR, an unsupported
 * browser, the kill switch, first load before the worker takes control) just means there is nothing
 * to tell, and the worker protects itself without us (it refuses entries stamped for another user).
 */

/** The slice of ServiceWorkerContainer used here (and injectable in tests). */
export interface SWMessagingLike {
    controller: { postMessage(message: unknown): void } | null;
    addEventListener?(type: 'controllerchange', listener: () => void): void;
    removeEventListener?(type: 'controllerchange', listener: () => void): void;
}

function post(container: SWMessagingLike | undefined, message: unknown): boolean {
    try {
        if (!container?.controller) return false;
        container.controller.postMessage(message);
        return true;
    } catch {
        return false;
    }
}

/** Sign-out: drop the signed-in user's offline copies and forget who they were. */
export function clearServiceWorkerUserCache(container: SWMessagingLike | undefined): boolean {
    return post(container, { type: 'clear-user-cache' });
}

/** The sign-out links call this on click: the page is about to be replaced, so it is fire-and-forget. */
export function clearUserCacheOnSignOut(): void {
    clearServiceWorkerUserCache(typeof navigator === 'undefined' ? undefined : navigator.serviceWorker);
}

/**
 * Ask the server who is signed in right now and tell the worker. A different answer than the worker
 * last heard makes it drop the previous user's copies. 401 means nobody (null); an unknown answer
 * (offline, server error) says nothing, because "I could not find out" is not "signed out".
 */
export async function syncServiceWorkerUser(
    container: SWMessagingLike | undefined,
    fetchImpl: typeof fetch = fetch,
): Promise<void> {
    if (!container?.controller) return;
    try {
        const res = await fetchImpl('/api/session/context', {
            credentials: 'same-origin',
            headers: { Accept: 'application/json' },
        });
        if (res.status === 401) {
            post(container, { type: 'set-user', marker: null });
            return;
        }
        if (!res.ok) return;
        const body = (await res.json()) as { data?: { user?: { sessionMarker?: unknown } } };
        const marker = body.data?.user?.sessionMarker;
        if (typeof marker === 'string' && marker) post(container, { type: 'set-user', marker });
    } catch {
        /* offline or unreadable: leave the worker's idea of the user as it is */
    }
}

/**
 * Pages for people who are not signed in as staff (clients, signers, payers). Asking the server "who is
 * signed in" from each of them would be a 401 per page view for nothing: the cache is dropped the next
 * time the sign-in page loads, which is the only way back into a staff session.
 */
const PUBLIC_PAGE = /^\/(book|report|report-gate|report-view|agreements|checkout|invoice|verify|v|portal|repair-request|repair-builder|confirm|sms-optin|unsubscribe|legal|integrations|docs)(\/|$)/;

export function isPublicPage(pathname: string): boolean {
    return PUBLIC_PAGE.test(pathname);
}

const AUTH_PAGE = /^\/(login|join|forgot-password|reset-password|logout|agent-login|agent-logout|oauth)(\/|$)/;

/** A client-side navigation that crosses a sign-in or sign-out page is where the signed-in user changes. */
export function shouldSyncOnNavigation(from: string, to: string): boolean {
    return AUTH_PAGE.test(from) || AUTH_PAGE.test(to);
}
