function notificationsApp() {
    return {
        items: [],
        nextCursor: null,
        filter: 'all',
        loading: false,

        // Sub-spec B Task 3 — counters surfaced into PageHeader meta
        get unreadCount() {
            return this.items.filter(i => !i.readAt).length;
        },
        get urgentCount() {
            return this.items.filter(i => !i.readAt && i.priority === 'urgent').length;
        },

        async load(reset = true) {
            this.loading = true;
            if (reset) { this.items = []; this.nextCursor = null; }
            const params = new URLSearchParams();
            if (this.filter === 'unread') params.set('unread', '1');
            if (!reset && this.nextCursor) params.set('cursor', this.nextCursor);
            try {
                const r = await authFetch('/api/notifications?' + params.toString());
                if (r.status === 401) { window.location.href = '/login'; return; }
                if (!r.ok) return;
                const d = await r.json();
                this.items = reset ? (d.data?.items || []) : this.items.concat(d.data?.items || []);
                this.nextCursor = d.data?.nextCursor || null;
            } finally { this.loading = false; }
        },

        async loadMore() { await this.load(false); },

        async setFilter(f) { this.filter = f; await this.load(); },

        async markRead(id) {
            await authFetch('/api/notifications/mark-read', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: [id] })
            });
            const it = this.items.find(x => x.id === id);
            if (it) it.readAt = new Date().toISOString();
            if (typeof window.__oiPollNotify === 'function') window.__oiPollNotify();
        },

        async markAllRead() {
            await authFetch('/api/notifications/mark-all-read', { method: 'POST' });
            this.items.forEach(it => { if (!it.readAt) it.readAt = new Date().toISOString(); });
            if (typeof window.__oiPollNotify === 'function') window.__oiPollNotify();
            if (typeof showToast === 'function') showToast('All notifications marked read.');
        },

        async archive(id) {
            await authFetch('/api/notifications/' + encodeURIComponent(id), { method: 'DELETE' });
            this.items = this.items.filter(x => x.id !== id);
            if (typeof window.__oiPollNotify === 'function') window.__oiPollNotify();
        },

        formatTime(iso) {
            const d = new Date(iso);
            const diff = (Date.now() - d.getTime()) / 1000;
            if (diff < 60) return 'just now';
            if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
            if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
            return d.toLocaleDateString();
        }
    };
}
