function marketplace() {
    return {
        templates: [],
        libraries: [],          // Spec 5G M2 — comment / snippet packs
        loading: false,
        search: '',
        category: '',
        sort: 'featured',
        page: 1,
        pageSize: 12,
        totalPages: 1,
        toast: '',
        toastLink: '',
        // Polish 5 — preview modal state
        previewOpen: false,
        previewTemplate: null,
        previewSchema: null,
        previewItemCount: 0,
        // Spec 5B P3 — aggregate counts across all sections.
        previewCannedTotal: 0,
        previewDefectTotal: 0,
        // Round 37 — update confirm modal state. `updateTarget` holds either
        // a template or library object; `updateKind` is 'template' | 'library'
        // so the same modal can serve both card types.
        updateConfirmOpen: false,
        updateTarget: null,
        updateKind: '',

        async init() {
            await this.load();
        },

        async load() {
            this.loading = true;
            this.page = 1;
            await Promise.all([this._fetch(), this._fetchLibraries()]);
            this.loading = false;
        },

        async _fetchLibraries() {
            try {
                const res = await authFetch('/api/templates/marketplace/libraries');
                if (!res.ok) return;
                const data = await res.json();
                this.libraries = data.data || [];
            } catch (_) { /* tolerate */ }
        },

        async importLibrary(id) {
            const res = await authFetch(`/api/templates/marketplace/libraries/${id}/import`, { method: 'POST' });
            if (!res.ok) {
                this.showToast('Library import failed. Please try again.', '');
                return;
            }
            const data = await res.json();
            const lib = this.libraries.find((l) => l.id === id);
            if (lib) { lib.importedSemver = lib.semver; lib.hasUpdate = false; }
            const count = data.data?.rowCount || 0;
            this.showToast(`Imported ${count} comments to your library`, '/comments');
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
            this.applySort();
            this.totalPages = this.templates.length < this.pageSize ? this.page : this.page + 1;
        },

        // Polish 5 — client-side sort (server returns featured DESC, downloadCount DESC by default)
        applySort() {
            const t = [...this.templates];
            if (this.sort === 'name') {
                t.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
            } else if (this.sort === 'popular') {
                t.sort((a, b) => (b.downloadCount || 0) - (a.downloadCount || 0));
            } else if (this.sort === 'recent') {
                // Round 4 polish — sort by createdAt descending (newest first)
                t.sort((a, b) => {
                    const ca = new Date(a.createdAt || 0).getTime();
                    const cb = new Date(b.createdAt || 0).getTime();
                    return cb - ca;
                });
            } else {
                // featured first
                t.sort((a, b) => {
                    const fa = a.featured ? 1 : 0;
                    const fb = b.featured ? 1 : 0;
                    if (fa !== fb) return fb - fa;
                    return (b.downloadCount || 0) - (a.downloadCount || 0);
                });
            }
            this.templates = t;
        },

        resort() {
            this.applySort();
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

        // Round 37 — open the confirm modal for a template or library update.
        // We intentionally do NOT POST here: the user must confirm the
        // "creates a new copy" semantics before we mutate anything.
        openUpdateConfirm(target, kind) {
            this.updateTarget = target;
            this.updateKind = kind;
            this.updateConfirmOpen = true;
        },

        closeUpdateConfirm() {
            this.updateConfirmOpen = false;
            this.updateTarget = null;
            this.updateKind = '';
        },

        async confirmUpdate() {
            if (!this.updateTarget) return;
            const t = this.updateTarget;
            const kind = this.updateKind;
            this.updateConfirmOpen = false;
            if (kind === 'template') {
                const res = await authFetch(`/api/templates/marketplace/${t.id}/update`, { method: 'POST' });
                if (!res.ok) {
                    this.showToast('Update failed. Please try again.', '');
                    return;
                }
                const data = await res.json();
                const newId = data.data && data.data.newLocalId;
                const cardT = this.templates.find((x) => x.id === t.id);
                if (cardT) { cardT.importedSemver = cardT.semver; cardT.hasUpdate = false; }
                this.showToast(`Updated to v${t.semver} — old copy preserved`, newId ? `/templates/${newId}/edit` : '');
            } else if (kind === 'library') {
                const res = await authFetch(`/api/templates/marketplace/libraries/${t.id}/update`, { method: 'POST' });
                if (!res.ok) {
                    this.showToast('Library update failed. Please try again.', '');
                    return;
                }
                const data = await res.json();
                const added = (data.data && data.data.rowsAdded) || 0;
                const cardL = this.libraries.find((x) => x.id === t.id);
                if (cardL) { cardL.importedSemver = cardL.semver; cardL.hasUpdate = false; }
                this.showToast(`Added ${added} new entries — old entries preserved`, '/comments');
            }
            this.updateTarget = null;
            this.updateKind = '';
        },

        // Polish 5 + Spec 5B P3 — open preview modal with parsed schema
        // tree, plus aggregate counts of canned comments & defects so the
        // marketplace browser can see "what's in this template" before
        // importing.
        openPreview(t) {
            this.previewTemplate = t;
            // Marketplace API returns schema as JSON string OR object — normalize
            let schema = t.schema;
            if (typeof schema === 'string') {
                try { schema = JSON.parse(schema); } catch { schema = null; }
            }
            // Decorate every item with per-tab counts so the template can
            // render badges without re-walking the schema each render.
            const sections = (schema?.sections || []).map((sec) => ({
                ...sec,
                items: (sec.items || []).map((it) => {
                    const t = it.tabs || {};
                    const info = (t.information || []).length;
                    const lim  = (t.limitations || []).length;
                    const def  = (t.defects || []).length;
                    return { ...it, _info: info, _lim: lim, _def: def };
                }),
            }));
            this.previewSchema = schema ? { ...schema, sections } : null;
            this.previewItemCount = sections.reduce((sum, s) => sum + (s.items?.length || 0), 0);
            this.previewCannedTotal = sections.reduce(
                (sum, s) => sum + (s.items || []).reduce((a, it) => a + (it._info || 0) + (it._lim || 0) + (it._def || 0), 0),
                0
            );
            this.previewDefectTotal = sections.reduce(
                (sum, s) => sum + (s.items || []).reduce((a, it) => a + (it._def || 0), 0),
                0
            );
            this.previewOpen = true;
        },

        showToast(msg, link) {
            this.toast = msg;
            this.toastLink = link;
            setTimeout(() => { this.toast = ''; this.toastLink = ''; }, 4000);
        },
    };
}
