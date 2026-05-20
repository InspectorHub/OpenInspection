/**
 * Design System 0520 subsystem E P6 — IntegrationGrid Alpine factory.
 *
 * Fetches /api/integrations/status on init and renders the cards.
 * Action button maps each integration id to its OAuth-start endpoint;
 * unknown ids no-op rather than navigating to '#'.
 */
(function () {
    const ACTION_URLS = {
        qbo:    '/api/qbo/oauth/start',
        stripe: '/api/stripe/connect/start',
        gcal:   '/api/calendar/oauth/start',
        // resend / places / gemini have no action button (env-only).
    };

    function factory() {
        return {
            integrations: [],
            error: '',

            async init() {
                try {
                    const r = await fetch('/api/integrations/status', { credentials: 'same-origin' });
                    if (!r.ok) {
                        this.error = `Failed to load integrations (${r.status})`;
                        return;
                    }
                    const body = await r.json();
                    this.integrations = body?.data?.integrations ?? [];
                } catch (_e) {
                    this.error = 'Network error';
                }
            },

            action(i) {
                const url = ACTION_URLS[i?.id];
                if (!url) return;
                window.location.href = url;
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('integrationsGrid', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('integrationsGrid', factory));
    window.integrationsGrid = factory;
})();
