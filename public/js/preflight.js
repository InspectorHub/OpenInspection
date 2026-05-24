/**
 * Design System 0520 subsystem E P1.4 — preflight-checks Alpine factory.
 *
 * Fetches GET /api/inspections/:id/preflight on init and re-fetches
 * when `refresh-preflight` fires on window. Broadcasts the boolean
 * `allPassed` via the `preflight-status` window event so the publish
 * modal's submit button can listen + disable itself.
 */
(function () {
    function factory() {
        return {
            checks: {
                allRated: false, unratedCount: 0,
                apprenticeReviewed: false, apprenticePending: 0,
                propertyFactsComplete: false, missingFacts: [],
                coverPhotoSet: false, agreementSigned: false,
                noOpenFields: true, openFieldCount: 0,
            },
            loading: false,
            error: '',

            get allPassed() {
                const c = this.checks;
                return c.allRated && c.apprenticeReviewed
                    && c.propertyFactsComplete && c.coverPhotoSet
                    && c.agreementSigned && c.noOpenFields;
            },

            async init() {
                window.addEventListener('refresh-preflight', () => this.load());
                await this.load();
            },

            async load() {
                const id = window.__inspectionEditorRoot?.inspectionId;
                if (!id) return;
                this.loading = true;
                this.error = '';
                try {
                    const r = await fetch(`/api/inspections/${id}/preflight`, { credentials: 'same-origin' });
                    if (!r.ok) {
                        this.error = `Pre-flight check failed (${r.status})`;
                        return;
                    }
                    const body = await r.json();
                    if (body?.data) this.checks = body.data;
                    window.dispatchEvent(new CustomEvent('preflight-status', {
                        detail: { allPassed: this.allPassed, checks: this.checks },
                    }));
                } catch (_e) {
                    this.error = 'Network error';
                } finally {
                    this.loading = false;
                }
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('preflightChecks', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('preflightChecks', factory));
    window.preflightChecks = factory;
})();
