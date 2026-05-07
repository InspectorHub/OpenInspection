function commentsAdminFactory() {
    return {
        items: [],
        loading: false,
        saving: false,
        // Spec 2026-05-07 — primary axis is rating bucket (matches the
        // inspection-edit Library drawer tabs); category + section stay as
        // secondary filters.
        bucket: '',
        categoryFilter: '',
        sectionFilter: '',
        bucketTabs: [
            { value: '',             label: 'All' },
            { value: 'satisfactory', label: 'Satisfactory' },
            { value: 'monitor',      label: 'Monitor' },
            { value: 'defect',       label: 'Defect' },
        ],
        modalOpen: false,
        editingId: null,
        form: { category: '', text: '', ratingBucket: '', section: '' },

        async init() {
            await this.reload();
        },

        get distinctCategories() {
            return [...new Set(this._allItems.map(r => r.category).filter(Boolean))].sort();
        },
        get distinctSections() {
            return [...new Set(this._allItems.map(r => r.section).filter(Boolean))].sort();
        },

        // Cache the unfiltered server response so the dropdown options stay
        // populated even after the user narrows the bucket tab.
        _allItems: [],

        setBucket(b) {
            this.bucket = b || '';
            this.reload();
        },

        async reload() {
            this.loading = true;
            try {
                // Server-side bucket + section filtering (matches spec API
                // contract). Category stays client-side because it's a
                // free-text legacy field and the dataset is tiny.
                const qs = new URLSearchParams();
                if (this.bucket) qs.set('rating', this.bucket);
                if (this.sectionFilter) qs.set('section', this.sectionFilter);
                const url = '/api/admin/comments' + (qs.toString() ? '?' + qs.toString() : '');
                const res = await authFetch(url);
                const json = await res.json();
                const all = json.data?.comments || [];
                // Preserve the full set for the category/section autocompletes,
                // even though the visible list is filtered.
                if (!this.bucket && !this.sectionFilter) {
                    this._allItems = all;
                } else if (this._allItems.length === 0) {
                    // first load with a filter applied — re-fetch unfiltered
                    // in the background so dropdowns populate.
                    void this._refreshAllItems();
                }
                this.items = this.categoryFilter
                    ? all.filter(c => c.category === this.categoryFilter)
                    : all;
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Failed to load: ' + e.message, true);
            } finally {
                this.loading = false;
            }
        },

        async _refreshAllItems() {
            try {
                const res = await authFetch('/api/admin/comments');
                const json = await res.json();
                this._allItems = json.data?.comments || [];
            } catch { /* non-fatal — autocompletes just stay empty */ }
        },

        openCreate() {
            this.editingId = null;
            this.form = { category: '', text: '', ratingBucket: '', section: '' };
            this.modalOpen = true;
        },

        openEdit(comment) {
            this.editingId = comment.id;
            this.form = {
                category: comment.category || '',
                text: comment.text,
                ratingBucket: comment.ratingBucket || '',
                section: comment.section || '',
            };
            this.modalOpen = true;
        },

        async save() {
            if (!this.form.text.trim()) {
                if (typeof window.showToast === 'function') window.showToast('Comment text is required', true);
                return;
            }
            this.saving = true;
            try {
                const body = {
                    text: this.form.text,
                    category: this.form.category || null,
                    ratingBucket: this.form.ratingBucket || null,
                    section: this.form.section || null,
                };
                const url = this.editingId
                    ? '/api/admin/comments/' + this.editingId
                    : '/api/admin/comments';
                const method = this.editingId ? 'PUT' : 'POST';
                const res = await authFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error?.message || 'HTTP ' + res.status);
                }
                this.modalOpen = false;
                if (typeof window.showToast === 'function') window.showToast(this.editingId ? 'Updated' : 'Created');
                await this.reload();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Save failed: ' + e.message, true);
            } finally {
                this.saving = false;
            }
        },

        async confirmDelete(comment) {
            const preview = comment.text.length > 40 ? comment.text.slice(0, 40) + '...' : comment.text;
            if (!confirm('Delete comment "' + preview + '"?')) return;
            try {
                const res = await authFetch('/api/admin/comments/' + comment.id, { method: 'DELETE' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                if (typeof window.showToast === 'function') window.showToast('Deleted');
                await this.reload();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message, true);
            }
        },
    };
}

function registerB4Component(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll(`[x-data="${name}"]`).forEach(el => {
            try { window.Alpine.destroyTree?.(el); } catch {}
            try { window.Alpine.initTree(el); } catch {}
        });
    }
}
registerB4Component('commentsAdmin', commentsAdminFactory);
