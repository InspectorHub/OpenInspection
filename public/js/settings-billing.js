/**
 * Design System 0520 subsystem C P9 T9.2 — Alpine factory for
 * /settings/billing. Fetches /api/billing/summary on init and surfaces
 * the breakdown; errors are caught + displayed inline rather than
 * thrown so the page is still useful when the portal is offline.
 *
 * The factory accepts the deployment profile flags as a literal arg
 * (rendered server-side into the x-data expression) so the page can
 * branch on standalone / saas-silo / saas-shared without a round-trip
 * to a second endpoint just to learn its own mode.
 */
(function () {
    function factory(profile) {
        profile = profile || { hasBilling: false, hasSeatQuota: false, saasTopology: null };
        return {
            // Server-passed deployment context.
            hasBilling:   !!profile.hasBilling,
            hasSeatQuota: !!profile.hasSeatQuota,
            saasTopology: profile.saasTopology || null,

            // /api/billing/summary fields.
            tier:      'free',
            maxUsers:  1,
            seatsUsed: 0,
            permanent: 0,
            guests:    0,
            portalUrl: '',
            loading:   true,
            error:     '',

            /** Subtitle copy under the page H1 — adapts to the active mode. */
            get headerSubtitle() {
                if (!this.hasBilling) {
                    return 'You’re running OpenInspection self-hosted — no per-seat charges, no Stripe round-trip.';
                }
                if (!this.hasSeatQuota) {
                    return 'Flat-tier subscription billed through Stripe. Seats inside this silo aren’t metered.';
                }
                return 'Seats, plan, and where your invoices live. Payment-method changes happen in the Stripe portal.';
            },

            // Currency formatter for the inline cost-estimate panel.
            // USD-only for now — extend if Stripe ever quotes another currency.
            fmtMoney(n) {
                const v = Number(n) || 0;
                return '$' + v.toFixed(2);
            },

            async init() {
                this.loading = true;
                this.error   = '';
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
