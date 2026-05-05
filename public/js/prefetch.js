/**
 * Spec 4E — Inspection prefetch.
 * Auto-caches dashboard buckets (needsAttention + today + thisWeek, cap 50)
 * into Dexie so inspectors can go offline mid-session and have their assigned
 * inspections instantly available.
 */
import { db, openDb } from './db.js';

const PREFETCH_BUCKETS = ['needsAttention', 'today', 'thisWeek'];
const PREFETCH_CAP     = 50;
const REFRESH_MS       = 5 * 60 * 1000;

let timer = null;

export async function startPrefetch({ onProgress, onComplete } = {}) {
    await openDb();
    await runOnce({ onProgress, onComplete });
    if (timer) clearInterval(timer);
    timer = setInterval(() => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
            runOnce({ onProgress, onComplete });
        }
    }, REFRESH_MS);
}

export function stopPrefetch() {
    if (timer) { clearInterval(timer); timer = null; }
}

async function runOnce({ onProgress, onComplete }) {
    if (!navigator.onLine) return;
    let dash;
    try {
        const dashRes = await fetch('/api/inspections/dashboard', { credentials: 'include' });
        if (!dashRes.ok) return;
        dash = await dashRes.json();
    } catch {
        return;
    }
    const ids = PREFETCH_BUCKETS
        .flatMap(b => (dash.data?.[b] || []).map(i => i.id))
        .filter(Boolean)
        .slice(0, PREFETCH_CAP);
    if (ids.length === 0) {
        onComplete?.({ done: 0, total: 0 });
        return;
    }
    let done = 0;
    for (const id of ids) {
        try {
            await prefetchOne(id);
            done++;
            onProgress?.({ done, total: ids.length });
        } catch { /* skip failed; retry next cycle */ }
    }
    onComplete?.({ done, total: ids.length });
}

async function prefetchOne(id) {
    const cached = await db.inspections.get(id);
    if (cached && Date.now() - (cached.fetchedAt || 0) < REFRESH_MS) return;
    const res = await fetch(`/api/inspections/${id}/full`, { credentials: 'include' });
    if (!res.ok) return;
    const json = await res.json();
    const { inspection, template, results, base } = json.data || {};
    if (!inspection) return;
    await db.transaction('rw', db.inspections, db.results, db.bases, async () => {
        await db.inspections.put({ ...inspection, template, fetchedAt: Date.now() });
        if (results) await db.results.put({ ...results, syncedAt: Date.now() });
        if (base)    await db.bases.put({ ...base, syncedAt: Date.now() });
    });
}
