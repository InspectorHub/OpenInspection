/**
 * Design System 0520 subsystem E P4.3 — IdentitySwitcher factory.
 *
 * Lazy-loads /api/identities on init; sends /api/identities/switch
 * with a single linkedUserId on click and navigates to the redirect
 * URL the server returns. Errors surface inline on the panel rather
 * than as a window.alert so the dropdown stays usable.
 */
(function () {
    function factory() {
        return {
            identities: [],
            submitting: false,
            error: '',

            async init() {
                try {
                    const r = await fetch('/api/identities', { credentials: 'same-origin' });
                    if (!r.ok) return;
                    const body = await r.json();
                    this.identities = body?.data?.identities ?? [];
                } catch (_e) { /* leave empty */ }
            },

            async switchTo(linkedUserId) {
                this.submitting = true;
                this.error = '';
                try {
                    const r = await fetch('/api/identities/switch', {
                        method:  'POST',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify({ linkedUserId }),
                        credentials: 'same-origin',
                    });
                    if (!r.ok) {
                        const body = await r.json().catch(() => ({}));
                        this.error = body?.error?.message || `Switch failed (${r.status})`;
                        return;
                    }
                    const body = await r.json();
                    window.location.href = body?.data?.redirectUrl ?? '/dashboard';
                } catch (_e) {
                    this.error = 'Network error';
                } finally {
                    this.submitting = false;
                }
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('identitySwitcher', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('identitySwitcher', factory));
    window.identitySwitcher = factory;
})();
