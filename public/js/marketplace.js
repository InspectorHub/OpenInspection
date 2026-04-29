function marketplace() {
    return {
        templates: [],
        loading: false,
        search: '',
        category: '',
        page: 1,
        pageSize: 12,
        totalPages: 1,
        toast: '',
        toastLink: '',

        async init() {
            await this.load();
        },

        async load() {
            this.loading = true;
            this.page = 1;
            await this._fetch();
            this.loading = false;
        },

        async _fetch() {
            const params = new URLSearchParams({
                page: String(this.page),
                pageSize: String(this.pageSize),
            });
            if (this.search) params.set('search', this.search);
            if (this.category) params.set('category', this.category);

            const res = await authFetch(`/api/templates/marketplace?${params}`);
            if (!res.ok) return;
            const data = await res.json();
            this.templates = data.data || [];
            // Estimate pages from returned data (simple heuristic)
            this.totalPages = this.templates.length < this.pageSize ? this.page : this.page + 1;
        },

        async prevPage() {
            if (this.page <= 1) return;
            this.page--;
            await this._fetch();
        },

        async nextPage() {
            this.page++;
            await this._fetch();
        },

        async importTemplate(id) {
            const res = await authFetch(`/api/templates/marketplace/${id}/import`, { method: 'POST' });
            if (!res.ok) {
                this.showToast('Import failed. Please try again.', '');
                return;
            }
            const data = await res.json();
            const localId = data.data && data.data.localTemplateId;
            const t = this.templates.find(t => t.id === id);
            if (t) { t.importedSemver = t.semver; t.hasUpdate = false; }
            this.showToast('Template imported!', localId ? `/templates/${localId}/edit` : '');
        },

        showToast(msg, link) {
            this.toast = msg;
            this.toastLink = link;
            setTimeout(() => { this.toast = ''; this.toastLink = ''; }, 4000);
        },
    };
}
