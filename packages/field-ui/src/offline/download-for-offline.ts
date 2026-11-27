/**
 * #476 — deliberately download one inspection for offline use.
 *
 * Offline only works today if the inspector already opened that inspection
 * and its photos while online: the service worker only caches what the
 * device has already fetched. This module is the page side of the explicit
 * alternative:
 *
 *  - `offlineCopyStatus` reads the service worker's per-user cache (found
 *    by prefix, never by a hardcoded version) and reports whether the
 *    inspection's core payload (editor page + loader payload + results) and
 *    how many of its photos are stored on this device.
 *  - `downloadForOffline` asks the service worker (MessageChannel) to fetch
 *    those URLs now, while online, and store them stamped for this user.
 *    The worker does the fetching: a plain page fetch of the editor page
 *    would not be cached (the worker only caches navigation requests), and
 *    the worker owns the per-user stamp the cache is served by.
 *
 * No React import. The editor banner (FieldEditor) owns the rendering;
 * this module only answers "what is cached" and "fetch it now".
 */

export interface OfflineCopyStatus {
    /** The Cache API exists in this browser at all. */
    supported: boolean;
    /** The editor page + inspection + results payloads are all cached. */
    inspectionCached: boolean;
    /** Photos stored on this device. */
    photosCached: number;
    /** Photos the inspection carries (uploaded keys only). */
    photosTotal: number;
}

export interface DownloadResult {
    ok: boolean;
    cached: number;
    total: number;
    /** Why a download that stored nothing failed ('no-service-worker' | 'timeout'). */
    reason?: string;
}

/** The three URLs an offline inspection needs besides its photos. */
export function coreOfflineUrls(inspectionId: string): string[] {
    return [
        `/inspections/${inspectionId}/edit`,
        `/api/inspections/${inspectionId}`,
        `/api/inspections/${inspectionId}/results`,
    ];
}

/**
 * Every uploaded photo key in the results map: item photos plus canned and
 * custom defect photos. Pending entries (empty key) are not uploaded yet
 * and have no URL to cache. The map is dual-keyed (composite + bare item
 * id), so keys are deduped.
 */
export function collectPhotoKeys(
    results: Record<string, Record<string, unknown>>,
): string[] {
    const keys = new Set<string>();
    const take = (photos: unknown): void => {
        if (!Array.isArray(photos)) return;
        for (const p of photos) {
            if (p && typeof p === 'object' && typeof (p as { key?: unknown }).key === 'string') {
                const key = (p as { key: string }).key;
                if (key) keys.add(key);
            }
        }
    };
    for (const entry of Object.values(results)) {
        take(entry.photos);
        const tabs = entry.tabs as { defects?: Array<{ photos?: unknown }> } | undefined;
        for (const d of tabs?.defects ?? []) take(d.photos);
        const customComments = entry.customComments as
            | { defects?: Array<{ photos?: unknown }> }
            | undefined;
        for (const d of customComments?.defects ?? []) take(d.photos);
    }
    return [...keys];
}

async function openUserCache(): Promise<Cache | null> {
    if (typeof caches === 'undefined') return null;
    const names = await caches.keys();
    const name = names.find((n) => n.startsWith('openinspection-user-'));
    if (!name) return null;
    return caches.open(name);
}

export async function offlineCopyStatus(
    inspectionId: string,
    photoUrls: readonly string[],
): Promise<OfflineCopyStatus> {
    const supported = typeof caches !== 'undefined';
    const cache = await openUserCache();
    if (!cache) {
        return { supported, inspectionCached: false, photosCached: 0, photosTotal: photoUrls.length };
    }
    const has = async (url: string): Promise<boolean> => (await cache.match(url)) !== undefined;
    const core = await Promise.all(coreOfflineUrls(inspectionId).map(has));
    const photos = await Promise.all(photoUrls.map(has));
    return {
        supported,
        inspectionCached: core.every(Boolean),
        photosCached: photos.filter(Boolean).length,
        photosTotal: photoUrls.length,
    };
}

export async function downloadForOffline(
    inspectionId: string,
    urls: readonly string[],
    timeoutMs = 120_000,
): Promise<DownloadResult> {
    const total = urls.length;
    const controller =
        typeof navigator !== 'undefined' ? navigator.serviceWorker?.controller ?? null : null;
    if (!controller) return { ok: false, cached: 0, total, reason: 'no-service-worker' };
    return new Promise((resolve) => {
        const channel = new MessageChannel();
        const timer = setTimeout(
            () => resolve({ ok: false, cached: 0, total, reason: 'timeout' }),
            timeoutMs,
        );
        channel.port1.onmessage = (event: MessageEvent) => {
            clearTimeout(timer);
            const data = event.data as Partial<DownloadResult> | null;
            resolve({
                ok: data?.ok === true,
                cached: typeof data?.cached === 'number' ? data.cached : 0,
                total: typeof data?.total === 'number' ? data.total : total,
            });
        };
        controller.postMessage(
            { type: 'download-inspection', id: inspectionId, urls: [...urls] },
            [channel.port2],
        );
    });
}
