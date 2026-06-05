/**
 * sw-cleanup — Service Worker exorcism helpers (B-3 escape hatch).
 *
 * Extracts the zombie-SW cleanup logic that was previously inlined in root.tsx
 * so that sw-bootstrap.ts can reuse it for the kill-switch path.
 */

/** Minimal subset of ServiceWorkerContainer needed for cleanup (and for DI in tests). */
export interface SWContainerLike {
    getRegistrations(): Promise<{ unregister(): Promise<boolean> }[]>;
}

/**
 * Unregister every SW registration and drop all 'oi-*' caches.
 * Never throws — all errors are silently swallowed so callers are safe to
 * fire-and-forget.
 */
export async function unregisterAllServiceWorkers(
    container: SWContainerLike,
): Promise<void> {
    try {
        const regs = await container.getRegistrations();
        for (const reg of regs) {
            reg.unregister().catch(() => {});
        }
        if (regs.length > 0 && typeof caches !== 'undefined') {
            const keys = await caches.keys();
            for (const key of keys) {
                if (key.startsWith('oi-') || key.startsWith('openinspection-')) {
                    caches.delete(key).catch(() => {});
                }
            }
        }
    } catch {
        /* container unavailable — nothing to unregister */
    }
}
