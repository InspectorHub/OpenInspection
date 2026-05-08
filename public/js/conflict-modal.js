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
            // Sprint 1 A-5: 'edit' opens InlineTextPopover (async); other
            // choices resolve immediately via _applyChoice.
            if (choice === 'edit') {
                const self = this;
                if (!window.OIPrompt) return;
                window.OIPrompt.open({
                    title:       'Edit merged notes',
                    placeholder: 'Adjust the merged notes',
                    initial:     (cf.ours || '') + '\n\n--- Theirs ---\n' + (cf.theirs || ''),
                    scope:       'conflict-merge',
                    onApply: function (edited) {
                        self._applyChoice(cf, edited, 'edit_merged');
                    },
                });
                return;
            }
            const chosen = (choice === 'theirs') ? cf.theirs : cf.ours;
            const resolution = (choice === 'theirs') ? 'accept_theirs' : 'keep_mine';
            await this._applyChoice(cf, chosen, resolution);
        },

        async _applyChoice(cf, chosen, resolution) {
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
            // Sprint 1 A-11: record the resolution so it shows up in the
            // /api/admin/audit-logs feed. Fire-and-forget — never block UX.
            this._recordAuditLog(cf, resolution, chosen);
            await drainQueue();
        },

        _recordAuditLog(cf, resolution, mergedValue) {
            const fetcher = (typeof window.authFetch === 'function') ? window.authFetch : fetch;
            try {
                fetcher('/api/admin/audit-logs', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({
                        action:       'inspection.sync_conflict_resolved',
                        resourceType: 'inspection',
                        resourceId:   cf.inspectionId,
                        detail: {
                            itemId:      cf.itemId,
                            field:       cf.field,
                            resolution:  resolution,
                            ourValue:    cf.ours,
                            theirValue:  cf.theirs,
                            mergedValue: resolution === 'edit_merged' ? mergedValue : null,
                        },
                    }),
                }).catch(() => { /* silent — audit is best-effort */ });
            } catch (_) { /* ignore */ }
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
