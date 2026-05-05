function settingsEventTypesFactory() {
    return {
        types: [],
        loading: false,
        saving: false,
        seeding: false,
        modalOpen: false,
        editingId: null,
        form: {
            name: '',
            slug: '',
            defaultDurationMin: 30,
            priceDollars: 0,
            color: '#6366f1',
            sortOrder: 0,
        },

        async init() {
            await this.reload();
        },

        async reload() {
            this.loading = true;
            try {
                const res = await authFetch('/api/event-types');
                const json = await res.json();
                this.types = (json.data || []).slice().sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Failed to load event types: ' + e.message, true);
            } finally {
                this.loading = false;
            }
        },

        openCreate() {
            this.editingId = null;
            this.form = {
                name: '',
                slug: '',
                defaultDurationMin: 30,
                priceDollars: 0,
                color: '#6366f1',
                sortOrder: 0,
            };
            this.modalOpen = true;
        },

        openEdit(t) {
            this.editingId = t.id;
            this.form = {
                name:               t.name || '',
                slug:               t.slug || '',
                defaultDurationMin: t.defaultDurationMin ?? 30,
                priceDollars:       (t.defaultPriceCents || 0) / 100,
                color:              t.color || '#6366f1',
                sortOrder:          t.sortOrder ?? 0,
            };
            this.modalOpen = true;
        },

        async save() {
            this.saving = true;
            try {
                const body = {
                    name:               (this.form.name || '').trim(),
                    slug:               (this.form.slug || '').trim().toLowerCase(),
                    defaultDurationMin: this.form.defaultDurationMin || 30,
                    defaultPriceCents:  Math.round((this.form.priceDollars || 0) * 100),
                    color:              this.form.color || '#6366f1',
                    sortOrder:          this.form.sortOrder || 0,
                };
                if (!body.name || !body.slug) {
                    throw new Error('Name and slug are required');
                }
                if (!/^[a-z0-9_]+$/.test(body.slug)) {
                    throw new Error('Slug must be lowercase letters, digits, and underscores');
                }
                const url    = this.editingId ? '/api/event-types/' + this.editingId : '/api/event-types';
                const method = this.editingId ? 'PUT' : 'POST';
                const res = await authFetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error?.message || ('HTTP ' + res.status));
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

        async confirmDelete(t) {
            if (!confirm('Delete event type "' + t.name + '"? If it is in use, it will be deactivated instead.')) return;
            try {
                const res = await authFetch('/api/event-types/' + t.id, { method: 'DELETE' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                if (typeof window.showToast === 'function') window.showToast('Removed');
                await this.reload();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message, true);
            }
        },

        async seedDefaults() {
            this.seeding = true;
            try {
                const res = await authFetch('/api/event-types/seed', { method: 'POST' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                const r = json.data || {};
                if (typeof window.showToast === 'function') {
                    window.showToast('Seeded ' + (r.seeded ?? 0) + ' new, skipped ' + (r.skipped ?? 0));
                }
                await this.reload();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Seed failed: ' + e.message, true);
            } finally {
                this.seeding = false;
            }
        },
    };
}

function registerEventTypesComponent(name, factory) {
    document.addEventListener('alpine:init', () => window.Alpine.data(name, factory));
    if (window.Alpine && typeof window.Alpine.data === 'function') {
        window.Alpine.data(name, factory);
        document.querySelectorAll('[x-data="' + name + '"]').forEach(el => {
            try { window.Alpine.destroyTree?.(el); } catch (_) {}
            try { window.Alpine.initTree(el); } catch (_) {}
        });
    }
}
registerEventTypesComponent('settingsEventTypes', settingsEventTypesFactory);
