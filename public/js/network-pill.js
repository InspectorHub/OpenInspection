import { db, openDb } from './db.js';
import { drainQueue, syncEngineState } from './sync-engine.js';
import { detectTier } from './device-tier.js';

// Register via alpine:init so this works regardless of script load order.
// Module scripts load deferred AFTER classic scripts (i.e. after Alpine boots),
// so window.* registration races with Alpine's x-data evaluation. Alpine.data()
// inside an alpine:init listener is the project's standard pattern.
function networkPillFactory() {
    return {
        online: navigator.onLine,
        engineStatus: 'idle',
        pendingCount: 0,
        pendingItems: [],
        popoverOpen: false,
        tier: null,
        // Round 39 — hide on routes that have their own visible save state.
        // The inspection editor's per-section header already shows
        // 'Saving…/Saved/Error' inline, and its top-right corner is taken
        // by Preview / Publish buttons that the global pill was overlapping.
        get suppressed() {
            try { return /^\/inspections\/[^/]+\/edit$/.test(location.pathname); }
            catch (_) { return false; }
        },

        async init() {
            await openDb();
            this.tier = await detectTier();

            window.addEventListener('online',  () => { this.online = true;  this.syncNow(); });
            window.addEventListener('offline', () => { this.online = false; });

            syncEngineState.subscribe(s => { this.engineStatus = s.status; });

            const refresh = async () => {
                this.pendingCount = await db.syncQueue.count();
                this.pendingItems = await db.syncQueue.orderBy('createdAt').toArray();
            };
            refresh();
            setInterval(refresh, 1000);

            if (this.online) this.syncNow();
        },

        get label() {
            if (!this.online) return `Offline · ${this.pendingCount} pending`;
            if (this.engineStatus === 'drainingQueue') return `Syncing ${this.pendingCount}…`;
            if (this.pendingCount > 0) return `${this.pendingCount} pending`;
            return 'Online';
        },
        get dotClass() {
            if (!this.online) return 'bg-orange-500';
            if (this.engineStatus === 'drainingQueue') return 'bg-blue-500 animate-pulse';
            return 'bg-emerald-500';
        },

        async syncNow() {
            if (!this.online) return;
            await drainQueue();
        },
        async retryOne(id) {
            await db.syncQueue.update(id, { attempts: 0, nextAttemptAt: null });
            this.syncNow();
        },
    };
}

// Module scripts load AFTER Alpine boots in Alpine v3 (deferLoadingAlpine
// is a v2-only API, removed in v3). So register both via alpine:init for the
// rare case Alpine hasn't started AND immediately + re-init existing elements
// for the common case where Alpine already evaluated x-data with empty scope.
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
registerB4Component('networkPill', networkPillFactory);
