/**
 * Design System 0520 subsystem C P9 T9.2 — Alpine factory for
 * /settings/billing. Fetches /api/billing/summary on init and surfaces
 * the breakdown; errors are caught + displayed inline rather than
 * thrown so the page is still useful when the portal is offline.
 */
(function () {
    function factory() {
        return {
            tier:      'free',
            maxUsers:  1,
            seatsUsed: 0,
            permanent: 0,
            guests:    0,
            portalUrl: '',
            loading:   true,
            error:     '',

            async init() {
                this.loading = true;
                this.error = '';
                try {
                    const r = await fetch('/api/billing/summary', { credentials: 'same-origin' });
                    if (!r.ok) {
                        this.error = `Failed to load billing summary (${r.status})`;
                        return;
                    }
                    const body = await r.json();
                    if (body?.data) Object.assign(this, body.data);
                } catch (_e) {
                    this.error = 'Network error';
                } finally {
                    this.loading = false;
                }
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('settingsBilling', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('settingsBilling', factory));
    window.settingsBilling = factory;
})();
