import { useSyncExternalStore } from "react";

const noopSubscribe = () => () => {};

/**
 * The origin of the page the browser is on, or "" while the server renders and while the client hydrates.
 *
 * Reading `window.location.origin` straight in render gives the server one string and the client another, so
 * hydration finds text that is not what was rendered (React error #418). `useSyncExternalStore` takes the
 * server snapshot for the hydrating render and then renders again with the real value, which is the only
 * order that never disagrees with the HTML on the page.
 */
export function usePageOrigin(): string {
    return useSyncExternalStore(noopSubscribe, () => window.location.origin, () => "");
}
