/**
 * Design System 0520 subsystem D P8 — version diff viewer factory.
 *
 * Backed by the routes in src/api/inspections.ts (committed in P7.3):
 *   GET /api/inspections/:id/versions               → list versions
 *   GET /api/inspections/:id/versions/:n/diff?from=:m → computed diff
 *
 * The page mount passes the inspection id + the "to" version; we
 * default the "from" cursor to `to - 1` (or 1 if v1 is the only one
 * published). Clicking a version on the left re-targets `from`.
 */
(function () {
    const emptyDiff = () => ({ items: [], units: { added: [], removed: [] } });

    function factory(inspectionId, toVersion) {
        return {
            inspectionId,
            toVersion,
            fromVersion: Math.max(1, toVersion - 1),
            versions: [],
            diff: emptyDiff(),
            loading: false,

            async init() {
                try {
                    const r = await fetch(`/api/inspections/${this.inspectionId}/versions`, {
                        credentials: 'same-origin',
                    });
                    if (r.ok) {
                        this.versions = (await r.json())?.data?.versions ?? [];
                    }
                } catch (_e) { /* ignore — diff still works */ }
                await this.loadDiff();
            },

            async setFrom(n) {
                this.fromVersion = n;
                await this.loadDiff();
            },

            async loadDiff() {
                if (this.fromVersion === this.toVersion) {
                    this.diff = emptyDiff();
                    return;
                }
                this.loading = true;
                try {
                    const url = `/api/inspections/${this.inspectionId}/versions/${this.toVersion}/diff?from=${this.fromVersion}`;
                    const r = await fetch(url, { credentials: 'same-origin' });
                    if (r.ok) {
                        const body = await r.json();
                        this.diff = body?.data ?? emptyDiff();
                    }
                } finally {
                    this.loading = false;
                }
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('versionDiff', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('versionDiff', factory));
    window.versionDiff = factory;
})();
