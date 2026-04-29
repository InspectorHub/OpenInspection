document.addEventListener('alpine:init', () => {
    Alpine.data('metrics', () => ({
        period: '12m',
        data: null,
        loading: true,
        chart: null,

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
                    this.$nextTick(() => this.renderChart());
                }
            } catch (e) {
                console.error('[Metrics] load error', e);
            } finally {
                this.loading = false;
            }
        },

        renderChart() {
            if (!this.data || typeof Chart === 'undefined') return;
            const canvas = document.getElementById('revenue-chart');
            if (!canvas) return;
            if (this.chart) this.chart.destroy();
            this.chart = new Chart(canvas, {
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
                    scales: {
                        y: { ticks: { callback: v => '$' + v.toLocaleString() } },
                    },
                },
            });
        },

        fmt(cents) {
            return '$' + (cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2 });
        },
    }));
});
