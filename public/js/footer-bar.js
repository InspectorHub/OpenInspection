// Design System 0520 subsystem B phase 4 task 4.4 — FooterBar factory.
//
// Reads exclusively from window.OfflineQueue's 'state' events. Three
// derived view fields:
//   - syncStatus:    online | syncing | offline
//   - lastSyncedRel: "Nm ago" relative timestamp (or '' when never)
//
// Registered via `Alpine.data('footerBar', factory)` so the template's
// `x-data="footerBar()"` resolves correctly regardless of script-load
// order — see network-pill.js for the registerB4Component rationale.
// A stub of the same name lives in alpine-stubs.js to keep Alpine's
// first sweep quiet before this ESM lands.

import { formatRelativeTime } from '/js/conflict-resolver-helpers.js';

function footerBarFactory() {
    return {
        state: { online: true, length: 0, syncing: false, lastSyncedAt: null, conflicts: [] },

        get syncStatus() {
            if (!this.state.online) return 'offline';
            if (this.state.syncing) return 'syncing';
            return 'online';
        },

        get lastSyncedRel() {
            const ms = this.state.lastSyncedAt;
            if (!ms || typeof ms !== 'number') return '';
            return formatRelativeTime(Math.floor(ms / 1000));
        },

        init() {
            // Snapshot first (OfflineQueue may have already emitted before
            // we subscribed; reading state is idempotent).
            if (window.OfflineQueue?.state) {
                this.state = window.OfflineQueue.state;
            }
            window.OfflineQueue?.addEventListener('state', (e) => {
                if (e.detail) this.state = e.detail;
            });
        },
    };
}

// Module scripts load AFTER Alpine boots in v3, so register both via
// alpine:init (covers cold start) AND immediately + re-init existing
// trees (covers warm start where Alpine already evaluated x-data with
// the stub scope).
function registerB4Component(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll(`[x-data="${name}"]`).forEach((el) => {
            try { window.Alpine.destroyTree?.(el); } catch { /* ignore */ }
            try { window.Alpine.initTree(el); } catch { /* ignore */ }
        });
    }
}

// Keep window.footerBar as a back-compat shim in case anything else
// still calls it directly. Alpine.data takes precedence inside x-data.
window.footerBar = footerBarFactory;
registerB4Component('footerBar', footerBarFactory);
