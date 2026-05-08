/**
 * Sprint 2 S2-1 — Rating Systems library Alpine handler.
 *
 * Implements list / clone / edit / set-default / delete on /library/rating-systems.
 * Cloning prompts the inspector for a name via window.OIPrompt (Sprint 1 ban
 * on browser prompt() / confirm()). Editing opens the modal in the page;
 * delete confirmation is a separate modal driven by `showDeleteModal`.
 */
(function () {
    function blankLevel() {
        return { abbr: '', label: '', color: '#6366f1', bucket: 'satisfactory', hotkey: '' };
    }

    function register() {
        if (!window.Alpine || typeof window.Alpine.data !== 'function') return;
        window.Alpine.data('ratingSystems', function () {
            return {
                systems: [],
                loading: true,
                error: '',
                editing: null,
                editLevelError: '',
                showEditModal: false,
                showDeleteModal: false,
                deleteTarget: null,
                saving: false,

                async init() {
                    await this.load();
                },

                async load() {
                    this.loading = true;
                    this.error = '';
                    try {
                        const res = await authFetch('/api/rating-systems');
                        const json = await res.json().catch(() => null);
                        if (!res.ok) {
                            this.error = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                            this.systems = [];
                        } else {
                            this.systems = (json && json.data) || [];
                        }
                    } catch (e) {
                        this.error = (e && e.message) || 'Failed to load rating systems';
                        this.systems = [];
                    } finally {
                        this.loading = false;
                    }
                },

                cloneSystem(sys) {
                    const self = this;
                    if (!window.OIPrompt) {
                        this.error = 'Inline prompt is unavailable. Reload the page.';
                        return;
                    }
                    window.OIPrompt.open({
                        title: 'Clone rating system',
                        placeholder: 'Name for the new system',
                        initial: sys.name + ' (Custom)',
                        scope: 'rating-systems-clone',
                        onApply: async (name) => {
                            try {
                                const res = await authFetch('/api/rating-systems/' + encodeURIComponent(sys.id) + '/clone', {
                                    method: 'POST',
                                    headers: { 'Content-Type': 'application/json' },
                                    body: JSON.stringify({ name }),
                                });
                                const json = await res.json().catch(() => null);
                                if (!res.ok) {
                                    self.error = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                                    return;
                                }
                                await self.load();
                                self.error = '';
                                if (typeof showToast === 'function') showToast('Cloned ' + sys.name);
                                // Open the new copy in the edit modal so the inspector can tweak it.
                                if (json && json.data) self.openEdit(json.data);
                            } catch (e) {
                                self.error = (e && e.message) || 'Clone failed';
                            }
                        },
                    });
                },

                openEdit(sys) {
                    // Deep-copy so cancelling discards changes.
                    this.editing = {
                        id:          sys.id,
                        name:        sys.name,
                        slug:        sys.slug,
                        description: sys.description || '',
                        isDefault:   !!sys.isDefault,
                        isSeed:      !!sys.isSeed,
                        levels:      (sys.levels || []).map(function (l) {
                            return {
                                abbr:   l.abbr || '',
                                label:  l.label || '',
                                color:  l.color || '#6366f1',
                                bucket: l.bucket || 'satisfactory',
                                hotkey: l.hotkey || '',
                            };
                        }),
                    };
                    this.editLevelError = '';
                    this.showEditModal = true;
                },

                closeEdit() {
                    this.showEditModal = false;
                    this.editing = null;
                    this.editLevelError = '';
                },

                addLevel() {
                    if (!this.editing) return;
                    if (this.editing.levels.length >= 10) return;
                    this.editing.levels.push(blankLevel());
                },

                removeLevel(idx) {
                    if (!this.editing) return;
                    if (this.editing.levels.length <= 2) return;
                    this.editing.levels.splice(idx, 1);
                },

                async saveEdit() {
                    if (!this.editing) return;
                    this.editLevelError = '';
                    // Client-side guard mirroring the Zod schema so the inspector gets
                    // immediate feedback without a round-trip.
                    for (let i = 0; i < this.editing.levels.length; i++) {
                        const lvl = this.editing.levels[i];
                        if (!lvl.abbr || !lvl.label) {
                            this.editLevelError = 'Level ' + (i + 1) + ' needs both an abbreviation and a label.';
                            return;
                        }
                        if (!/^#[0-9a-fA-F]{6}$/.test(lvl.color || '')) {
                            this.editLevelError = 'Level ' + (i + 1) + ' has an invalid color (expected #aabbcc).';
                            return;
                        }
                    }

                    const body = {
                        name:        this.editing.name,
                        slug:        this.editing.slug,
                        description: this.editing.description || undefined,
                        isDefault:   !!this.editing.isDefault,
                        levels:      this.editing.levels.map(function (l, idx) {
                            const out = {
                                abbr:   l.abbr,
                                label:  l.label,
                                color:  l.color,
                                bucket: l.bucket,
                                order:  idx,
                            };
                            if (l.hotkey) out.hotkey = l.hotkey;
                            return out;
                        }),
                    };

                    this.saving = true;
                    try {
                        const isCreate = !this.editing.id;
                        const url = isCreate
                            ? '/api/rating-systems'
                            : '/api/rating-systems/' + encodeURIComponent(this.editing.id);
                        const res = await authFetch(url, {
                            method: isCreate ? 'POST' : 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify(body),
                        });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) {
                            this.editLevelError = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                            return;
                        }
                        this.closeEdit();
                        await this.load();
                        if (typeof showToast === 'function') showToast(isCreate ? 'Created rating system' : 'Saved rating system');
                    } catch (e) {
                        this.editLevelError = (e && e.message) || 'Save failed';
                    } finally {
                        this.saving = false;
                    }
                },

                async setDefault(sys) {
                    try {
                        const res = await authFetch('/api/rating-systems/' + encodeURIComponent(sys.id), {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ isDefault: true }),
                        });
                        if (!res.ok) {
                            const j = await res.json().catch(() => null);
                            this.error = (j && j.error && j.error.message) || ('HTTP ' + res.status);
                            return;
                        }
                        await this.load();
                        if (typeof showToast === 'function') showToast('Default rating system updated');
                    } catch (e) {
                        this.error = (e && e.message) || 'Failed to set default';
                    }
                },

                confirmDelete(sys) {
                    this.deleteTarget = sys;
                    this.showDeleteModal = true;
                },

                async performDelete() {
                    if (!this.deleteTarget) return;
                    try {
                        const res = await authFetch('/api/rating-systems/' + encodeURIComponent(this.deleteTarget.id), { method: 'DELETE' });
                        const json = await res.json().catch(() => null);
                        if (!res.ok) {
                            this.error = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                            this.showDeleteModal = false;
                            return;
                        }
                        this.showDeleteModal = false;
                        this.deleteTarget = null;
                        await this.load();
                        if (typeof showToast === 'function') showToast('Deleted rating system');
                    } catch (e) {
                        this.error = (e && e.message) || 'Delete failed';
                        this.showDeleteModal = false;
                    }
                },
            };
        });
    }

    if (window.Alpine) register();
    else document.addEventListener('alpine:init', register);
})();
