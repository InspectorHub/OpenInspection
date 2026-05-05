/**
 * Spec 4E — Mounts prefetch loop on dashboard page.
 * Pure ES-module wrapper that runs after Alpine has mounted (waits for `dashboard` x-data).
 */
import { startPrefetch } from './prefetch.js';

function getDashboardComponent() {
    const root = document.querySelector('[x-data^="dashboard"]');
    if (!root) return null;
    // Alpine v3 stores component instance on the root via __x or _x_dataStack
    // eslint-disable-next-line no-underscore-dangle
    return root._x_dataStack?.[0] ?? null;
}

async function init() {
    let cmp = getDashboardComponent();
    let waits = 0;
    while (!cmp && waits < 30) {
        await new Promise(r => setTimeout(r, 100));
        cmp = getDashboardComponent();
        waits++;
    }
    await startPrefetch({
        onProgress: ({ done, total }) => {
            if (cmp) cmp.cacheProgress = `Cached ${done}/${total}`;
        },
        onComplete: ({ done, total }) => {
            if (cmp) {
                cmp.cacheProgress = null;
                if (window.toast?.success && total > 0) {
                    window.toast.success(`${done} inspections cached for offline`);
                }
            }
        },
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
