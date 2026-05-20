/**
 * Design System 0520 subsystem E P2.1 — WorkflowTabs Alpine factory.
 *
 * Backs the 6-tab dashboard nav. Counts come from the dashboard's
 * `inspections-loaded` window event (detail: { inspections }), so
 * we never refetch — the same payload that drives the table drives
 * the badges.
 *
 * The selected tab is persisted to the URL (`?workflow=:id`) and
 * broadcast via `workflow-filter-changed` for the dashboard's
 * visible-rows computer to AND-filter against time + tag filters.
 */
(function () {
    function factory() {
        return {
            selected: new URLSearchParams(window.location.search).get('workflow') ?? 'all',
            tabs: [
                { id: 'all',             label: 'All',             count: 0 },
                { id: 'active',          label: 'Active',          count: 0 },
                { id: 'drafts',          label: 'Drafts',          count: 0 },
                { id: 'awaitingPayment', label: 'Awaiting payment', count: 0 },
                { id: 'published',       label: 'Published',       count: 0 },
                { id: 'cancelled',       label: 'Cancelled',       count: 0 },
            ],

            init() {
                window.addEventListener('inspections-loaded', (e) => {
                    this.recount(e?.detail?.inspections ?? []);
                });
            },

            recount(inspections) {
                for (const t of this.tabs) {
                    t.count = inspections.filter(i => this.match(t.id, i)).length;
                }
            },

            match(tabId, i) {
                switch (tabId) {
                    case 'all':             return true;
                    case 'active':          return i.status === 'scheduled' || i.status === 'in_progress' || i.status === 'draft';
                    case 'drafts':          return i.status === 'draft';
                    case 'awaitingPayment': return (i.status === 'delivered' || i.status === 'published') && i.paymentStatus !== 'paid';
                    case 'published':       return i.status === 'delivered' || i.status === 'published';
                    case 'cancelled':       return i.status === 'cancelled';
                    default:                return true;
                }
            },

            select(id) {
                this.selected = id;
                const url = new URL(window.location.href);
                url.searchParams.set('workflow', id);
                window.history.replaceState({}, '', url);
                window.dispatchEvent(new CustomEvent('workflow-filter-changed', {
                    detail: { workflow: id },
                }));
            },
        };
    }

    if (window.Alpine?.data) window.Alpine.data('workflowTabs', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('workflowTabs', factory));
    window.workflowTabs = factory;
})();
