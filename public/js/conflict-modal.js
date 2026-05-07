import { db, openDb } from './db.js';
import { drainQueue } from './sync-engine.js';

// See network-pill.js for the rationale behind alpine:init registration.
function conflictModalFactory() {
    return {
        open: false,
        conflicts: [],
        index: 0,
        get current() { return this.conflicts[this.index]; },

        async init() {
            await openDb();
            // Round 37 — defensive filter + one-shot cleanup of stale empty
            // conflict rows. A row with no base/ours/theirs content is not a
            // real merge conflict (it pops an empty 3-column modal that the
            // user can't act on). Seen in the wild on /templates page load.
            const isEmpty = (c) => !((c?.base ?? '').toString().trim() ||
                                     (c?.ours ?? '').toString().trim() ||
                                     (c?.theirs ?? '').toString().trim());
            try {
                const all = await db.conflicts.toArray();
                for (const c of all) if (isEmpty(c)) await db.conflicts.delete(c.id);
            } catch (_) { /* idb open race — refresh below will retry */ }

            const refresh = async () => {
                const all = await db.conflicts.orderBy('createdAt').toArray();
                this.conflicts = all.filter((c) => !isEmpty(c));
                this.open = this.conflicts.length > 0;
                if (this.index >= this.conflicts.length) this.index = 0;
            };
            refresh();
            setInterval(refresh, 1000);
        },

        async resolve(choice) {
            const cf = this.current;
            if (!cf) return;
            let chosen = cf.ours;
            if (choice === 'theirs') chosen = cf.theirs;
            else if (choice === 'edit') {
                const edited = window.prompt('Edit the merged notes:', cf.ours + '\n\n--- Theirs ---\n' + cf.theirs);
                if (edited == null) return;
                chosen = edited;
            }

            const r = await db.results.get(cf.inspectionId);
            if (r?.data?.[cf.itemId]) {
                r.data[cf.itemId][cf.field] = chosen;
                r.data[cf.itemId].updatedAt = Date.now();
                await db.results.put(r);
                const baseRow = await db.bases.get(cf.inspectionId);
                await db.syncQueue.add({
                    id: crypto.randomUUID(),
                    op: 'results.merge',
                    payload: { inspectionId: cf.inspectionId, baseSyncedAt: r.syncedAt || 0, base: baseRow?.data || {}, ours: r.data },
                    attempts: 0, createdAt: Date.now(),
                });
            }
            await db.conflicts.delete(cf.id);
            await drainQueue();
        },
    };
}

// See network-pill.js for the rationale behind this dual registration.
function registerB4Component(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll(`[x-data="${name}"]`).forEach(el => {
            try { window.Alpine.destroyTree?.(el); } catch {}
            try { window.Alpine.initTree(el); } catch {}
        });
    }
}
registerB4Component('conflictModal', conflictModalFactory);
