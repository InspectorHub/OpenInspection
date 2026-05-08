/**
 * Sprint 1 Sub-spec D — Report viewer Alpine controller.
 *
 * Provides:
 *  - activeSection tracking via IntersectionObserver
 *  - Tab switching (full / summary / safety) — sets html[data-viewer-tab] for
 *    the @media print rules in styles.css
 *  - Share dropdown (copy link / email link / share with agent)
 *  - PDF dropdown (print full / summary / safety) — uses window.print() so we
 *    stay on the Cloudflare Workers Free plan (no Browser Rendering binding)
 *  - Keyboard accessibility (Esc closes any open dropdown)
 */
(function () {
    function setupReportViewer() {
        if (!window.Alpine || typeof window.Alpine.data !== 'function') return;
        window.Alpine.data('reportViewer', function (initial) {
            initial = initial || {};
            return {
                inspection:       initial.inspection || {},
                sections:         initial.sections || [],
                role:             initial.role || 'client',
                activeSection:    null,
                currentTab:       initial.tab || 'full',  // 'full' | 'summary' | 'safety'
                shareOpen:        false,
                pdfOpen:          false,

                init() {
                    document.documentElement.dataset.viewerTab = this.currentTab;
                    this.observeActiveSection();
                    // Close any open popover on Esc — keyboard parity per design system.
                    this._escHandler = (e) => {
                        if (e.key === 'Escape') {
                            this.shareOpen = false;
                            this.pdfOpen = false;
                        }
                    };
                    window.addEventListener('keydown', this._escHandler);
                },

                destroy() {
                    if (this._escHandler) window.removeEventListener('keydown', this._escHandler);
                },

                observeActiveSection() {
                    if (typeof IntersectionObserver === 'undefined') return;
                    const opts = { rootMargin: '-30% 0px -65% 0px', threshold: 0 };
                    const obs = new IntersectionObserver((entries) => {
                        for (const e of entries) {
                            if (e.isIntersecting) {
                                this.activeSection = e.target.id.replace(/^section-/, '');
                            }
                        }
                    }, opts);
                    document.querySelectorAll('[id^="section-"]').forEach((el) => obs.observe(el));
                },

                switchTab(tab) {
                    if (tab !== 'full' && tab !== 'summary' && tab !== 'safety') return;
                    this.currentTab = tab;
                    document.documentElement.dataset.viewerTab = tab;
                    window.scrollTo({ top: 0, behavior: 'instant' in window.scrollTo ? 'instant' : 'auto' });
                },

                openPublish() {
                    if (typeof window.publishInspection === 'function') {
                        window.publishInspection(this.inspection.id);
                    }
                },

                // Share dropdown
                toggleShare() {
                    this.shareOpen = !this.shareOpen;
                    if (this.shareOpen) this.pdfOpen = false;
                },
                async copyLink() {
                    try {
                        if (navigator.clipboard) {
                            await navigator.clipboard.writeText(window.location.href);
                            if (typeof window.showToast === 'function') window.showToast('Link copied');
                        }
                    } catch (err) {
                        // Silent fallback — clipboard may be blocked in iframes.
                        console.warn('[report-viewer] clipboard write failed', err);
                    }
                    this.shareOpen = false;
                },
                emailLink() {
                    const subject = 'Inspection report — ' + (this.inspection.propertyAddress || '');
                    const body    = 'View the report: ' + window.location.href;
                    window.open('mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body));
                    this.shareOpen = false;
                },
                async shareToAgent() {
                    this.shareOpen = false;
                    const fetchFn = typeof window.authFetch === 'function' ? window.authFetch : window.fetch.bind(window);
                    try {
                        const res = await fetchFn('/api/inspections/' + this.inspection.id + '/share-agent', { method: 'POST' });
                        const data = await res.json();
                        if (res.ok && data.success) {
                            if (typeof window.showToast === 'function') window.showToast('Link emailed to agent');
                        } else {
                            const msg = (data && data.error && data.error.message) || 'Could not share with agent';
                            if (typeof window.showToast === 'function') window.showToast(msg, false);
                        }
                    } catch (err) {
                        console.warn('[report-viewer] share-agent failed', err);
                        if (typeof window.showToast === 'function') window.showToast('Network error sharing link', false);
                    }
                },

                // PDF dropdown — print-based export
                togglePdf() {
                    this.pdfOpen = !this.pdfOpen;
                    if (this.pdfOpen) this.shareOpen = false;
                },
                printAs(view) {
                    this.switchTab(view);
                    this.pdfOpen = false;
                    // Allow the DOM to settle (data attribute drives @media print rules).
                    setTimeout(() => window.print(), 150);
                },
            };
        });
    }

    if (window.Alpine) {
        setupReportViewer();
    } else {
        document.addEventListener('alpine:init', setupReportViewer);
    }
})();
