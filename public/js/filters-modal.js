/**
 * Design System 0520 subsystem E P3.2 — Filters modal factory.
 *
 * Lazy-loads agents + tags on first open. Apply / Reset both
 * broadcast `filters-changed` with the full payload so the dashboard
 * mirror is always consistent (no partial updates).
 */
(function () {
    function factory() {
        return {
            open: false,
            dateFrom: '',
            dateTo:   '',
            agentId:  '',
            tagIds:   [],
            agents:   [],
            tags:     [],
            _loaded:  false,

            async openModal() {
                this.open = true;
                if (!this._loaded) await this._load();
            },
            close() { this.open = false; },

            async _load() {
                try {
                    const [aR, tR] = await Promise.all([
                        fetch('/api/agents/buyer-agents', { credentials: 'same-origin' }).catch(() => null),
                        fetch('/api/tags',                { credentials: 'same-origin' }).catch(() => null),
                    ]);
                    if (aR?.ok) {
                        const body = await aR.json();
                        this.agents = body?.data?.agents ?? body?.data ?? [];
                    }
                    if (tR?.ok) {
                        const body = await tR.json();
                        this.tags = body?.data ?? [];
                    }
                } finally {
                    this._loaded = true;
                }
            },

            _emit() {
                window.dispatchEvent(new CustomEvent('filters-changed', {
                    detail: {
                        dateFrom: this.dateFrom,
                        dateTo:   this.dateTo,
                        agentId:  this.agentId,
                        tagIds:   [...this.tagIds],
                    },
                }));
            },

            apply() {
                this._emit();
                this.open = false;
            },

            reset() {
                this.dateFrom = '';
                this.dateTo = '';
                this.agentId = '';
                this.tagIds = [];
                this._emit();
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('filtersModal', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('filtersModal', factory));
    window.filtersModal = factory;
})();
