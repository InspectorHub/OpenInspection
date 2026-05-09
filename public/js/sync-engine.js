/**
 * B4 — Sync engine state machine + queue drain + quota monitor.
 * Loaded on every authenticated page; consumes Dexie syncQueue, calls server
 * sync endpoints, applies results to local stores or moves to conflicts.
 */
import { db, openDb } from './db.js';
import { estimateQuota, detectTier } from './device-tier.js';

const MAX_ATTEMPTS = 5;

export const syncEngineState = (() => {
    const listeners = new Set();
    let state = { status: 'idle', total: 0, done: 0, lastError: null };
    return {
        get: () => state,
        set: (s) => { state = { ...state, ...s }; listeners.forEach(l => l(state)); },
        reset: () => { state = { status: 'idle', total: 0, done: 0, lastError: null }; listeners.forEach(l => l(state)); },
        subscribe: (fn) => { listeners.add(fn); fn(state); return () => listeners.delete(fn); },
    };
})();

const ENDPOINT = {
    // Iter-2 bug #11 — forward the dirty-field map so the server can skip
    // 3-way comparison on fields the local user has not edited. Keeping the
    // field optional preserves backwards-compat with older clients.
    'results.merge':         (p) => ({ method: 'POST',   url: `/api/inspections/${p.inspectionId}/results/merge`, json: { baseSyncedAt: p.baseSyncedAt, base: p.base, ours: p.ours, ...(p.dirtyFields ? { dirtyFields: p.dirtyFields } : {}) } }),
    'photo.upload':          (p) => ({ method: 'POST',   url: `/api/inspections/${p.inspectionId}/upload`, formData: makePhotoForm(p) }),
    'photo.delete':          (p) => ({ method: 'DELETE', url: `/api/inspections/${p.inspectionId}/items/${p.itemId}/photos/${p.photoIndex}` }),
    'signature.inspector':   (p) => ({ method: 'POST',   url: `/api/inspections/${p.inspectionId}/inspector-signature`, json: { signatureBase64: p.signatureBase64, signedAt: p.signedAt } }),
};

function makePhotoForm(p) {
    const fd = new FormData();
    fd.append('file', p.blob, p.fileName || 'photo.jpg');
    fd.append('itemId', p.itemId);
    return fd;
}

function backoffMs(attempts) { return Math.min(16000, 1000 * 2 ** attempts); }

/**
 * Drain the syncQueue once. Honors backoff: rows whose `nextAttemptAt > now`
 * are skipped this pass.
 */
export async function drainQueue({ fetch: fetchFn = fetch } = {}) {
    await openDb();
    const now = Date.now();
    const queue = (await db.syncQueue.toArray()).filter(r => !r.nextAttemptAt || r.nextAttemptAt <= now);

    if (queue.length === 0) {
        syncEngineState.set({ status: 'idle', total: 0, done: 0 });
        return;
    }

    syncEngineState.set({ status: 'drainingQueue', total: queue.length, done: 0 });

    for (const row of queue) {
        const builder = ENDPOINT[row.op];
        if (!builder) {
            await db.syncQueue.delete(row.id);
            continue;
        }
        const req = builder(row.payload);
        let res;
        try {
            res = await fetchFn(req.url, {
                method: req.method,
                ...(req.json ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(req.json) } : {}),
                ...(req.formData ? { body: req.formData } : {}),
            });
        } catch (e) {
            await markRetry(row, String(e?.message || e));
            continue;
        }

        if (res.status === 401) {
            syncEngineState.set({ status: 'failed', lastError: 'unauthorized' });
            if (typeof window !== 'undefined') window.location.href = '/login';
            return;
        }

        if (res.status === 409) {
            const body = await res.json().catch(() => ({}));
            if (body?.error?.code === 'MERGE_CONFLICT' && row.op === 'results.merge') {
                const { conflicts } = body.error.details || {};
                for (const cf of conflicts || []) {
                    await db.conflicts.put({
                        id: crypto.randomUUID(),
                        inspectionId: row.payload.inspectionId,
                        itemId: cf.itemId, field: cf.field,
                        base: cf.base, ours: cf.ours, theirs: cf.theirs,
                        createdAt: Date.now(),
                    });
                }
                await db.syncQueue.delete(row.id);
                syncEngineState.set({ status: 'conflict' });
                continue;
            }
        }

        if (res.ok) {
            const body = await res.json().catch(() => ({}));
            await applySuccess(row, body);
            await db.syncQueue.delete(row.id);
            syncEngineState.set({ done: syncEngineState.get().done + 1 });
            continue;
        }

        if (res.status >= 500) {
            await markRetry(row, `HTTP ${res.status}`);
            continue;
        }

        await db.syncQueue.delete(row.id);
        syncEngineState.set({ lastError: `HTTP ${res.status}` });
    }

    if ((await db.syncQueue.count()) === 0) {
        syncEngineState.set({ status: 'idle' });
    }
}

async function applySuccess(row, body) {
    if (row.op === 'results.merge') {
        const merged = body?.data?.merged;
        const syncedAt = body?.data?.syncedAt;
        if (merged && row.payload.inspectionId) {
            await db.bases.put({ inspectionId: row.payload.inspectionId, data: merged, syncedAt });
            await db.results.put({ inspectionId: row.payload.inspectionId, data: merged, updatedAt: Date.now(), syncedAt });
        }
    }
}

async function markRetry(row, errMsg) {
    const attempts = (row.attempts || 0) + 1;
    if (attempts >= MAX_ATTEMPTS) {
        await db.syncQueue.update(row.id, { attempts, lastError: errMsg });
        syncEngineState.set({ status: 'failed', lastError: errMsg });
        return;
    }
    await db.syncQueue.update(row.id, {
        attempts, lastError: errMsg, nextAttemptAt: Date.now() + backoffMs(attempts),
    });
}

// ── Quota monitor (every 30s, per spec §3.6) ───────────────────────────────────
let quotaWarned = false;
async function quotaCheck() {
    try {
        const [tier, q] = await Promise.all([detectTier(), estimateQuota()]);
        if (!q.quota) return;
        const ratio = q.usage / q.quota;
        if (ratio >= tier.quotaThreshold && !quotaWarned) {
            quotaWarned = true;
            if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
                window.showToast(`Local storage ${Math.round(ratio*100)}% full — sync to free space.`, true);
            }
        }
        if (ratio < tier.quotaThreshold * 0.9) quotaWarned = false;
    } catch {}
}
if (typeof window !== 'undefined' && typeof setInterval !== 'undefined') {
    setInterval(quotaCheck, 30000);
}
