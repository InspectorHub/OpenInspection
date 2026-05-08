// handoff-decisions §7 — unsaved-changes guard.
//
// The original spec assumed React Router sub-routes; this codebase uses
// hono/jsx + Alpine with no SPA router. Pragmatic adaptation:
//   - beforeunload covers tab close / refresh / external nav (browser native dialog)
//   - document-level click guard intercepts <a href> nav within the app —
//     when dirty, asks via confirm(): leave or stay
//   - inspection-edit.js calls window.OIDirty.set(true) on input,
//     OIDirty.set(false) when saveResults succeeds.
//
// Tests this for inspection-edit. Other pages can opt in by calling
// window.OIDirty.set(true|false) anywhere they want guarded.

(function () {
    'use strict';

    let dirty = false;

    function set(value) {
        dirty = !!value;
    }

    function is() {
        return dirty;
    }

    // beforeunload — browser native. Chrome ignores returnValue text in
    // recent versions but still shows the dialog when truthy.
    window.addEventListener('beforeunload', function (e) {
        if (!dirty) return;
        e.preventDefault();
        e.returnValue = '';
        return '';
    });

    // In-app link guard. Use capture so we run before any page-level handler
    // that might also intercept the click. Only triggers on real navigations
    // (anchor with href, target absent or _self). Modal use:
    //   "You have unsaved changes. [Leave page] [Stay]"
    document.addEventListener('click', function (e) {
        if (!dirty) return;
        // Walk up the tree from the click target to find an anchor.
        let node = e.target;
        while (node && node !== document) {
            if (node.tagName === 'A') break;
            node = node.parentNode;
        }
        if (!node || node.tagName !== 'A') return;
        const href = node.getAttribute('href');
        if (!href) return;
        // Skip mailto/tel/javascript/anchor-only fragments.
        if (/^(mailto:|tel:|javascript:|#)/.test(href)) return;
        // Skip new-window links.
        const target = node.getAttribute('target');
        if (target && target !== '_self') return;
        // Skip same-page hash links to the current path.
        const url = new URL(node.href, window.location.href);
        if (url.pathname === window.location.pathname && url.hash) return;

        // Confirm.
        const ok = window.confirm(
            'You have unsaved changes that may be lost. Leave this page?'
        );
        if (!ok) {
            e.preventDefault();
            e.stopPropagation();
        } else {
            // User chose to leave; clear dirty so beforeunload doesn't fire again.
            dirty = false;
        }
    }, true);

    window.OIDirty = { set, is };
})();
