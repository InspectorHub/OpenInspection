document.addEventListener('alpine:init', () => {
    Alpine.data('metrics', () => ({
        period: '12m',
        data: null,
        loading: true,
        charts: {},

        // Sub-spec B Task 3 — readable period label for PageHeader meta
        periodLabel(p) {
            switch (p) {
                case '3m':  return 'last 3 months';
                case '6m':  return 'last 6 months';
                case '12m': return 'last 12 months';
                default:    return p;
            }
        },

        async init() {
            await this.load();
        },

        async load() {
            this.loading = true;
            try {
                const res = await authFetch(`/api/metrics?period=${this.period}`);
                if (res.ok) {
                    const json = await res.json();
                    this.data = json.data;
                    this.$nextTick(() => this.renderCharts());
                }
            } catch (e) {
                console.error('[Metrics] load error', e);
            } finally {
                this.loading = false;
            }
        },

        renderCharts() {
            if (!this.data || typeof Chart === 'undefined') return;

            // Destroy existing charts before re-render (period change)
            for (const k of ['revenue', 'volume', 'donut']) {
                if (this.charts[k]) { this.charts[k].destroy(); this.charts[k] = null; }
            }

            // Revenue bar chart
            const revCanvas = document.getElementById('revenue-chart');
            if (revCanvas) {
                this.charts.revenue = new Chart(revCanvas, {
                    type: 'bar',
                    data: {
                        labels: this.data.monthly.map(m => m.month),
                        datasets: [{
                            label: 'Revenue',
                            data: this.data.monthly.map(m => m.revenue / 100),
                            backgroundColor: '#6366f1',
                            borderRadius: 6,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: { y: { ticks: { callback: v => '$' + v.toLocaleString() } } },
                    },
                });
            }

            // Volume bar chart
            const volCanvas = document.getElementById('volume-chart');
            if (volCanvas) {
                this.charts.volume = new Chart(volCanvas, {
                    type: 'bar',
                    data: {
                        labels: this.data.monthly.map(m => m.month),
                        datasets: [{
                            label: 'Inspections',
                            data: this.data.monthly.map(m => m.count),
                            backgroundColor: '#10b981',
                            borderRadius: 6,
                        }],
                    },
                    options: {
                        responsive: true,
                        plugins: { legend: { display: false } },
                        scales: { y: { beginAtZero: true, ticks: { precision: 0 } } },
                    },
                });
            }

            // Service-distribution donut
            const donutCanvas = document.getElementById('service-donut');
            if (donutCanvas && this.data.serviceBreakdown.length > 0) {
                this.charts.donut = new Chart(donutCanvas, {
                    type: 'doughnut',
                    data: {
                        labels: this.data.serviceBreakdown.map(s => s.serviceName || '(Unnamed)'),
                        datasets: [{
                            data: this.data.serviceBreakdown.map(s => s.count),
                            backgroundColor: ['#6366f1', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6'],
                        }],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        plugins: { legend: { position: 'bottom', labels: { boxWidth: 12, font: { size: 11 } } } },
                    },
                });
            }
        },

        fmt(cents) {
            return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
        },
    }));
});
