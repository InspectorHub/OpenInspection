// Alpine stub factories for components whose real factory lives in an ESM
// module (`<script type="module">`) and therefore loads AFTER alpine.min.js
// fires `alpine:init`. Without these stubs, Alpine's first `x-data` evaluation
// references an undefined identifier and logs "is not defined" warnings for
// every property bound inside (e.g. `online`, `pendingItems`, `popoverOpen`).
//
// The real modules call `Alpine.data(name, factory)` and then re-init existing
// trees via `Alpine.destroyTree` + `Alpine.initTree`, so once a module loads
// it silently replaces the stub with the full implementation. Functionality
// is unchanged; the only effect is silencing the early-evaluation warnings.
//
// Loaded SYNC (no defer) BEFORE `alpine.min.js` (which is `defer`) so this
// file's `alpine:init` listener attaches before Alpine dispatches the event.
(function () {
    function noop() {}

    // Mirrors networkPillFactory() in network-pill.js. Only the property
    // shape matters — values are placeholders that the real factory
    // overwrites within milliseconds.
    function networkPillStub() {
        return {
            online: true,
            engineStatus: 'idle',
            pendingCount: 0,
            pendingItems: [],
            popoverOpen: false,
            tier: null,
            suppressed: false,
            label: '',
            dotClass: 'bg-emerald-500',
            init: noop,
            syncNow: noop,
            retryOne: noop,
        };
    }

    // Mirrors conflictModalFactory() in conflict-modal.js.
    function conflictModalStub() {
        return {
            open: false,
            conflicts: [],
            index: 0,
            resetting: false,
            current: null,
            init: noop,
            resolve: noop,
            resetLocal: noop,
            _applyChoice: noop,
            _recordAuditLog: noop,
        };
    }

    // Mirrors footerBar() in footer-bar.js — sticky sync-status footer
    // on the inspection editor. Real factory in /js/footer-bar.js is a
    // `<script type="module">` so it loads after Alpine; without this
    // stub the chip's x-show/x-text bindings throw "syncStatus is not
    // defined" until the module catches up.
    function footerBarStub() {
        return {
            state: { online: true, length: 0, syncing: false, lastSyncedAt: null, conflicts: [] },
            syncStatus: 'online',
            lastSyncedRel: '',
            init: noop,
        };
    }

    document.addEventListener('alpine:init', function () {
        if (window.Alpine && typeof window.Alpine.data === 'function') {
            window.Alpine.data('networkPill', networkPillStub);
            window.Alpine.data('conflictModal', conflictModalStub);
            window.Alpine.data('footerBar', footerBarStub);
        }
    });
})();
