/**
 * Iter-2 bug #12 — escape hatch for users trapped behind a stuck Sync
 * Conflict modal. Wipes the offline IndexedDB (`oi_offline` — the Dexie
 * store used by db.js / sync-engine.js / form-renderer.js) plus any
 * inspection-scoped localStorage keys, then reloads the page.
 *
 * Pure function so it can be unit-tested by injecting a fake
 * `indexedDB` and `localStorage`. The default export wires it to the
 * real browser globals.
 *
 * IDB name kept in sync with public/js/db.js — change here if the Dexie
 * database name changes.
 */
export const OFFLINE_DB_NAME = 'oi_offline';

const INSPECTION_LOCAL_STORAGE_PREFIXES = [
    'oi:inspection:',  // per-inspection scratchpad written by form-renderer
    'oi:dirty:',       // dirty-field cache fallback (iter-2 bug #11)
    'oi:lastSyncedAt:',// per-inspection sync watermark mirror
];

/**
 * Pure helper. Returns a result object so the caller can decide how to
 * surface success/failure (e.g. toast vs reload).
 *
 *   { ok: true, deletedDb: boolean, clearedKeys: number }
 *   { ok: false, error: string }
 */
export async function resetLocalStore({
    indexedDB: idb = (typeof indexedDB !== 'undefined' ? indexedDB : null),
    localStorage: ls = (typeof localStorage !== 'undefined' ? localStorage : null),
    dbName = OFFLINE_DB_NAME,
} = {}) {
    let deletedDb = false;
    if (idb && typeof idb.deleteDatabase === 'function') {
        try {
            await new Promise((resolve, reject) => {
                const req = idb.deleteDatabase(dbName);
                req.onsuccess = () => { deletedDb = true; resolve(); };
                req.onerror   = () => reject(req.error || new Error('deleteDatabase failed'));
                // Some browsers fire `blocked` when other tabs hold the DB
                // open. We treat it as a soft success — the caller will
                // reload anyway, which closes those tabs' connections.
                req.onblocked = () => { deletedDb = true; resolve(); };
            });
        } catch (err) {
            return { ok: false, error: (err && err.message) || String(err) };
        }
    }

    let clearedKeys = 0;
    if (ls && typeof ls.length === 'number') {
        // Walk in reverse so removeItem() doesn't shift indexes underneath us.
        for (let i = ls.length - 1; i >= 0; i--) {
            const key = ls.key(i);
            if (!key) continue;
            for (const prefix of INSPECTION_LOCAL_STORAGE_PREFIXES) {
                if (key.startsWith(prefix)) {
                    ls.removeItem(key);
                    clearedKeys++;
                    break;
                }
            }
        }
    }

    return { ok: true, deletedDb, clearedKeys };
}

// Browser entry point: clear + reload. Caller is expected to pop a
// `confirm()` first because the action is destructive.
export async function resetLocalAndReload() {
    const result = await resetLocalStore();
    if (typeof window !== 'undefined' && typeof window.location?.reload === 'function') {
        window.location.reload();
    }
    return result;
}
