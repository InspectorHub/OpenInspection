/**
 * Design System 0520 subsystem E P7 — AnalyticsPanel factory.
 *
 * Two read endpoints feed the panel:
 *   /api/analytics/growth?months=12
 *   /api/analytics/findings-heatmap
 *
 * The factory computes derived rendering props (polyline path + per-
 * cell opacity ratios) so the JSX stays a thin shell.
 */
(function () {
    function factory() {
        return {
            growth:      { months: [] },
            heatmapRows: [],
            loading:     false,
            error:       '',

            async init() {
                this.loading = true;
                this.error = '';
                try {
                    const [g, h] = await Promise.all([
                        fetch('/api/analytics/growth?months=12', { credentials: 'same-origin' }),
                        fetch('/api/analytics/findings-heatmap',  { credentials: 'same-origin' }),
                    ]);
                    if (g.ok) {
                        const body = await g.json();
                        this.growth = body?.data ?? { months: [] };
                    }
                    if (h.ok) {
                        const body = await h.json();
                        this.heatmapRows = this._assembleHeatmap(body?.data?.cells ?? []);
                    }
                } catch (_e) {
                    this.error = 'Failed to load analytics';
                } finally {
                    this.loading = false;
                }
            },

            get growthPath() {
                const months = this.growth?.months ?? [];
                if (months.length === 0) return '';
                const max = Math.max(...months.map(m => m.count), 1);
                return months.map((m, i) => {
                    const denom = Math.max(1, months.length - 1);
                    const x = (i / denom) * 600;
                    const y = 200 - (m.count / max) * 180 - 10;
                    return `${x.toFixed(1)},${y.toFixed(1)}`;
                }).join(' ');
            },

            _assembleHeatmap(cells) {
                const bySection = {};
                for (const c of cells) {
                    const row = bySection[c.section] ??= {
                        section: c.section,
                        satCount: 0, monitorCount: 0, defectCount: 0,
                    };
                    const cat = String(c.category || '').toLowerCase();
                    if (cat.startsWith('sat'))     row.satCount     = c.count;
                    else if (cat.startsWith('mon')) row.monitorCount = c.count;
                    else if (cat.startsWith('def')) row.defectCount  = c.count;
                }
                const rows = Object.values(bySection).slice(0, 20);
                const max = Math.max(
                    1,
                    ...rows.flatMap(r => [r.satCount, r.monitorCount, r.defectCount]),
                );
                for (const r of rows) {
                    r.satPct     = r.satCount     / max;
                    r.monitorPct = r.monitorCount / max;
                    r.defectPct  = r.defectCount  / max;
                }
                return rows;
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('analyticsPanel', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('analyticsPanel', factory));
    window.analyticsPanel = factory;
})();
