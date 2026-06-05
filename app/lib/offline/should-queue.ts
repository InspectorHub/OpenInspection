/**
 * Offline routing predicate.
 *
 * A pure, side-effect-free function so it can be tested in isolation
 * (vitest / happy-dom, no real navigator required).
 *
 * Returns true ONLY when the navigator explicitly reports offline.
 * - `undefined` navigator (SSR / test env without navigator) → false
 *   (never queue when we cannot determine connectivity)
 * - `onLine: true`  → false (online, use the normal fetcher path)
 * - `onLine: false` → true  (offline, route through the queue)
 */
export function shouldQueue(
    navigatorLike: { onLine: boolean } | undefined,
): boolean {
    if (navigatorLike === undefined) return false;
    return navigatorLike.onLine === false;
}
