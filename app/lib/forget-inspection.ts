/**
 * Tell the service worker that an inspection was deleted, so its cached reads, pages and photo files stop being served
 * offline. The page deletes through a route action (the delete happens on the server, inside the request), so the worker
 * never sees a `DELETE /api/inspections/<id>` of its own: this message is how it learns. No-op without a service worker,
 * without one controlling this page, and on the server; it never throws, because a cleanup must not fail the delete.
 */
export function forgetInspectionInServiceWorker(id: string): void {
    try {
        if (typeof navigator === "undefined") return;
        navigator.serviceWorker?.controller?.postMessage({ type: "forget-inspection", id });
    } catch {
        /* the worker is unavailable: the cached copy is replaced or dropped on its next read */
    }
}
