// Sprint 2 S2-5 — Settings sub-page Alpine data factory.
// Edits inspection-level config: schedule, inspector, template, gates.
//
// Round-2 backlog G1 / G2 / G3 — Property Facts strip (six inline-editable
// fields), Closing Date and Order ID + Referral Source. Property Facts
// persists via PATCH /api/inspections/:id/property-facts on input change
// (single-field saves), the rest piggy-backs on the existing form save.
//
// Note on T1 coordination: when T1 ships rating_system_id on templates,
// the `ratingSystemLabel` getter picks it up from the template object
// without any code change. Until then it returns null and the badge stays
// hidden via x-show.

document.addEventListener('alpine:init', () => {
    Alpine.data('inspectionSettingsPage', (inspectionId) => ({
        inspectionId,
        loading: true,
        saveState: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
        templates: [],
        inspectors: [],
        currentTemplate: null,
        // Feature #20 phase 2 — list of tenant rating systems (seed + custom).
        // Loaded once on sheet open from /api/rating-systems; rendered in the
        // Template fieldset as a dropdown bound to form.ratingSystemId.
        ratingSystems: [],
        form: {
            date: '',
            inspectorId: '',
            templateId: '',
            // Feature #20 phase 2 — current rating system id (UUID). Resolved
            // on load() by matching the snapshot's ratingSystem.name against
            // the rating-systems list. The user-facing select binds to this;
            // the @change handler routes through switchRatingSystem() which
            // calls the dedicated swap endpoint (NOT the generic save flow,
            // because the swap has side-effects on inspection_results).
            ratingSystemId: '',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
            // Round-2 backlog G2 — Closing Date (ISO YYYY-MM-DD) for CRM follow-ups.
            closingDate: '',
            // Round-2 backlog G3 — Order ID + Referral Source.
            orderId: '',
            referralSource: '',
        },

        // Round-2 backlog G1 — Property Facts strip. Loaded once on init,
        // then each input persists individually via saveFact() on change so
        // the inspector doesn't need to hit "Save" to see the banner update
        // on the published report.
        facts: {
            yearBuilt:      null,
            sqft:           null,
            foundationType: '',
            lotSize:        '',
            bedrooms:       null,
            bathrooms:      null,
        },
        factsState: 'idle', // 'idle' | 'saving' | 'saved' | 'error'
        factsTimer: null,
        // Sprint 3 S3-1 — Property auto-fill. `propertyAddress` is hydrated
        // from the inspection on load() so the autofill button can pass it
        // to the server-side proxy. `autofillState` drives the spinner.
        propertyAddress: '',
        autofillState: 'idle', // 'idle' | 'pending' | 'success' | 'no_key' | 'not_found' | 'error'
        autofillMessage: '',

        // Round-2 F3 — People card payload. Loaded from
        // /api/inspections/:id/people; rendered by the PeopleCard component.
        peopleCard: null,
        get peopleCardCount() {
            if (!this.peopleCard) return 0;
            return (this.peopleCard.inspector ? 1 : 0)
                 + (this.peopleCard.client    ? 1 : 0)
                 + (this.peopleCard.buyerAgents?.length   || 0)
                 + (this.peopleCard.listingAgents?.length || 0);
        },

        get ratingSystemLabel() {
            // T1 will set rating_system_id + ratingSystem fields on templates.
            // Until merge we return null and the badge stays hidden.
            const t = this.currentTemplate;
            if (!t) return null;
            // eslint-disable-next-line no-undef
            return t.ratingSystemLabel || t.ratingSystem?.label || (t.ratingSystemId ? 'Custom' : null);
        },

        async load() {
            try {
                const [inspRes, tplRes, teamRes, peopleRes, factsRes, rsRes] = await Promise.all([
                    window.authFetch('/api/inspections/' + this.inspectionId),
                    window.authFetch('/api/templates'),
                    window.authFetch('/api/team/members'),
                    // Round-2 F3 — People card payload.
                    window.authFetch('/api/inspections/' + this.inspectionId + '/people'),
                    // Round-2 backlog G1 — Property Facts strip.
                    window.authFetch('/api/inspections/' + this.inspectionId + '/property-facts'),
                    // Feature #20 phase 2 — tenant rating systems for the dropdown.
                    window.authFetch('/api/rating-systems'),
                ]);
                const inspJson = inspRes.ok ? await inspRes.json() : { data: {} };
                const insp = (inspJson.data && (inspJson.data.inspection || inspJson.data)) || {};
                this.form.date = (insp.date || '').slice(0, 10);
                this.form.inspectorId = insp.inspectorId || '';
                this.form.templateId = insp.templateId || '';
                this.propertyAddress = insp.propertyAddress || '';
                this.form.price = Number(insp.price || 0);
                this.form.paymentRequired = !!insp.paymentRequired;
                this.form.agreementRequired = !!insp.agreementRequired;
                // G2 / G3 round-trip — fields may be null on legacy rows.
                this.form.closingDate    = insp.closingDate    || '';
                this.form.orderId        = insp.orderId        || '';
                this.form.referralSource = insp.referralSource || '';

                // Feature #20 phase 2 — populate ratingSystems + resolve the
                // active one from the inspection's templateSnapshot. We match
                // by name because the snapshot embeds the system inline
                // rather than carrying a foreign-key id.
                if (rsRes && rsRes.ok) {
                    const rsJson = await rsRes.json();
                    this.ratingSystems = (rsJson && rsJson.data) || [];
                    try {
                        const snapRaw = insp.templateSnapshot;
                        if (snapRaw) {
                            const snap = typeof snapRaw === 'string' ? JSON.parse(snapRaw) : snapRaw;
                            const activeName = snap?.ratingSystem?.name;
                            const match = activeName
                                ? this.ratingSystems.find(rs => rs.name === activeName)
                                : null;
                            if (match) {
                                this.form.ratingSystemId = match.id;
                                // Snapshot the current id so the cancel branch of the
                                // switch-confirm modal can revert. Alpine 2-way binds
                                // mutate form.ratingSystemId BEFORE @change fires, so
                                // we need this side-channel.
                                this._lastConfirmedRatingSystemId = match.id;
                            }
                        }
                    } catch (e) { /* snapshot may be missing/legacy — leave default */ }
                }

                if (tplRes && tplRes.ok) {
                    const tplJson = await tplRes.json();
                    this.templates = tplJson.data || [];
                    this.currentTemplate = this.templates.find(t => t.id === this.form.templateId) || null;
                }
                if (teamRes && teamRes.ok) {
                    const teamJson = await teamRes.json();
                    const members = (teamJson.data && (teamJson.data.members || teamJson.data)) || [];
                    this.inspectors = members.filter(m => m.role === 'inspector' || m.role === 'admin' || m.role === 'owner');
                }
                if (peopleRes && peopleRes.ok) {
                    const peopleJson = await peopleRes.json();
                    this.peopleCard = (peopleJson && peopleJson.data) || null;
                }
                if (factsRes && factsRes.ok) {
                    const factsJson = await factsRes.json();
                    const f = (factsJson && factsJson.data) || {};
                    this.facts.yearBuilt      = f.yearBuilt      ?? null;
                    this.facts.sqft           = f.sqft           ?? null;
                    this.facts.foundationType = f.foundationType ?? '';
                    this.facts.lotSize        = f.lotSize        ?? '';
                    this.facts.bedrooms       = f.bedrooms       ?? null;
                    this.facts.bathrooms      = f.bathrooms      ?? null;
                }
            } catch (e) {
                console.error('settings.load failed', e);
            } finally {
                this.loading = false;
            }
        },

        // Round-2 backlog G1 — single-field property-facts save. Coerces
        // empty strings to null (clear the field) and string numerics to
        // numbers for the integer/float columns.
        async saveFact(field, raw) {
            const value = (() => {
                const trimmed = (typeof raw === 'string') ? raw.trim() : raw;
                if (trimmed === '' || trimmed === null || trimmed === undefined) return null;
                if (field === 'foundationType') return trimmed;
                if (field === 'lotSize')        return String(trimmed).slice(0, 50);
                if (field === 'bathrooms') {
                    const n = Number(trimmed);
                    return Number.isFinite(n) ? n : null;
                }
                // yearBuilt / sqft / bedrooms — integer
                const n = Number(trimmed);
                if (!Number.isFinite(n)) return null;
                return Math.round(n);
            })();

            this.factsState = 'saving';
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId + '/property-facts', {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ [field]: value }),
                });
                if (!res.ok) throw new Error('save failed');
                const json = await res.json();
                const f = (json && json.data) || {};
                // Re-sync local state from the server so the strip reflects
                // canonical values (e.g. integer coercion).
                this.facts.yearBuilt      = f.yearBuilt      ?? null;
                this.facts.sqft           = f.sqft           ?? null;
                this.facts.foundationType = f.foundationType ?? '';
                this.facts.lotSize        = f.lotSize        ?? '';
                this.facts.bedrooms       = f.bedrooms       ?? null;
                this.facts.bathrooms      = f.bathrooms      ?? null;
                this.factsState = 'saved';
                if (this.factsTimer) clearTimeout(this.factsTimer);
                this.factsTimer = setTimeout(() => {
                    if (this.factsState === 'saved') this.factsState = 'idle';
                }, 1500);
            } catch (e) {
                console.error('saveFact failed', e);
                this.factsState = 'error';
            }
        },

        // Sprint 3 S3-1 — Auto-fill from public records (Estated.io proxy).
        // Calls /api/inspections/:id/property-facts/autofill with the saved
        // property address. The server returns mapped facts or a
        // graceful-degrade reason. Each non-empty incoming field is patched
        // via the existing PATCH /property-facts handler — preserving any
        // values the inspector has already typed (we never overwrite a
        // non-empty manual entry).
        async autofillFromAddress() {
            if (!this.propertyAddress || this.propertyAddress.length < 5) {
                this.autofillState = 'error';
                this.autofillMessage = 'No address on file. Edit it first.';
                return;
            }
            this.autofillState = 'pending';
            this.autofillMessage = '';
            try {
                const res = await window.authFetch(
                    '/api/inspections/' + this.inspectionId + '/property-facts/autofill',
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ addressString: this.propertyAddress }),
                    },
                );
                const json = await res.json().catch(function () { return null; });
                if (!res.ok) {
                    this.autofillState = 'error';
                    this.autofillMessage = (json && json.error && json.error.message) || ('HTTP ' + res.status);
                    return;
                }
                const data = (json && json.data) || {};
                if (!data.facts) {
                    if (data.reason === 'NO_API_KEY') {
                        this.autofillState = 'no_key';
                        this.autofillMessage = 'Auto-fill is not configured on this server. Enter facts manually.';
                    } else if (data.reason === 'NOT_FOUND') {
                        this.autofillState = 'not_found';
                        this.autofillMessage = "Couldn't find property in public records. Enter facts manually.";
                    } else {
                        this.autofillState = 'error';
                        this.autofillMessage = "Provider couldn't supply data. Enter facts manually.";
                    }
                    return;
                }
                // Patch each non-empty field, preserving manual overrides.
                const facts = data.facts || {};
                let filled = 0;
                if (this.facts.yearBuilt == null && typeof facts.yearBuilt === 'number') {
                    await this.saveFact('yearBuilt', facts.yearBuilt); filled++;
                }
                if (this.facts.sqft == null && typeof facts.sqft === 'number') {
                    await this.saveFact('sqft', facts.sqft); filled++;
                }
                if (!this.facts.foundationType && typeof facts.foundationType === 'string' && facts.foundationType) {
                    await this.saveFact('foundationType', facts.foundationType); filled++;
                }
                if (!this.facts.lotSize && typeof facts.lotSize === 'string' && facts.lotSize) {
                    await this.saveFact('lotSize', facts.lotSize); filled++;
                }
                if (this.facts.bedrooms == null && typeof facts.bedrooms === 'number') {
                    await this.saveFact('bedrooms', facts.bedrooms); filled++;
                }
                if (this.facts.bathrooms == null && typeof facts.bathrooms === 'number') {
                    await this.saveFact('bathrooms', facts.bathrooms); filled++;
                }
                this.autofillState = 'success';
                this.autofillMessage = filled > 0
                    ? ('Auto-filled ' + filled + ' field' + (filled === 1 ? '' : 's') + '.')
                    : 'Property already fully filled — no fields updated.';
                if (typeof window.showToast === 'function') {
                    window.showToast(this.autofillMessage);
                }
            } catch (e) {
                console.error('autofill failed', e);
                this.autofillState = 'error';
                this.autofillMessage = (e && e.message) || 'Auto-fill failed';
            }
        },

        // Feature #20 phase 2 — rating-system swap.
        //
        // The <select>'s @change fires openRatingSwitchPrompt(newId), which
        // dispatches a `rating-switch-open` window event to the modal (it
        // lives at the page root because the sheet's transform/clipping
        // would otherwise trap a nested fixed overlay). The modal raises
        // `rating-switch-confirm {mode}` on its three buttons or
        // `rating-switch-cancel` on backdrop/Cancel; we listen for both
        // below via _ratingSwitchListeners installed once on first open.
        // Hard-reload after success so editor + viewer rebuild from the
        // new snapshot.
        //
        // No window.confirm/alert/prompt anywhere.
        _pendingRatingSwitchId: '',

        openRatingSwitchPrompt(newId) {
            // _lastConfirmedRatingSystemId is set in load() + after every
            // successful confirm; represents the id the snapshot actually
            // sits at. Bouncing back to the current value is a no-op.
            if (!newId || newId === this._lastConfirmedRatingSystemId) return;
            const target = this.ratingSystems.find(rs => rs.id === newId);
            if (!target) return;
            this._pendingRatingSwitchId = newId;
            this._ensureRatingSwitchListeners();
            // Best-effort count of currently rated items from the editor's
            // Alpine root. Falls back to 0 on legacy / no-editor pages.
            let ratedCount = 0;
            try {
                const editor = document.querySelector('[x-data*="inspectionEditor"]');
                const editorData = editor && window.Alpine && window.Alpine.$data(editor);
                const results = (editorData && editorData.results) || {};
                ratedCount = Object.values(results).filter(r => r && r.rating).length;
            } catch (_) { /* non-fatal */ }
            window.dispatchEvent(new CustomEvent('rating-switch-open', { detail: {
                targetName:       target.name,
                targetLevelCount: (target.levels && target.levels.length) || 0,
                ratedCount,
                newId,
            }}));
        },

        _ensureRatingSwitchListeners() {
            if (this._ratingSwitchInstalled) return;
            this._ratingSwitchInstalled = true;
            window.addEventListener('rating-switch-cancel', () => {
                // Revert the dropdown to the last persisted value.
                this.form.ratingSystemId = this._lastConfirmedRatingSystemId || '';
                this._pendingRatingSwitchId = '';
            });
            window.addEventListener('rating-switch-confirm', (e) => {
                const mode = (e && e.detail && e.detail.mode) || 'remap';
                this._doRatingSwitch(mode);
            });
        },

        // Feature #20 phase 3 — Save the current snapshot's structure
        // back to the source template, or save it as a new template.
        // Both read the snapshot off the editor's Alpine root (since
        // the structural edit lives there, not in this sheet's state).
        // Reuses the shared ConfirmDangerModal for the save-back warning
        // and the dedicated SaveAsNewTemplateModal for the new-name prompt.

        _captureSnapshotFromEditor() {
            const editor = document.querySelector('[x-data*="inspectionEditor"]');
            const data = editor && window.Alpine && window.Alpine.$data(editor);
            if (!data) return null;
            return {
                schemaVersion: 2,
                sections:      (data.sections || []).map(s => data._stripRuntimeKeys(s)),
                ratingSystem:  data._snapshotRatingSystem(),
            };
        },

        openSaveBackPrompt() {
            const templateId = this.form.templateId;
            if (!templateId) {
                if (typeof window.showToast === 'function') window.showToast('No source template attached to this inspection', true);
                return;
            }
            const tpl = (this.templates || []).find(t => t.id === templateId);
            this._ensureSaveListeners();
            window.dispatchEvent(new CustomEvent('confirm-danger-open', { detail: {
                title:        'Save back to source template?',
                body: [
                    `This rewrites the template "${tpl ? tpl.name : templateId.slice(0, 8)}" with this inspection's section + item structure and rating system.`,
                    'Future inspections created from this template will get the new structure.',
                    'Already-published inspections keep their frozen snapshot and are unaffected.',
                    'Per-item ratings / notes / photos from THIS inspection are NOT copied to the template.',
                ],
                confirmText:  'Overwrite template',
                confirmEvent: 'danger-confirm-save-back',
                tone:         'warning',
            }}));
        },

        openSaveAsNewPrompt() {
            this._ensureSaveListeners();
            const tpl = (this.templates || []).find(t => t.id === this.form.templateId);
            const suggested = tpl ? (tpl.name + ' (custom)') : 'New custom template';
            window.dispatchEvent(new CustomEvent('save-as-template-open', { detail: { suggestedName: suggested } }));
        },

        _ensureSaveListeners() {
            if (this._saveInstalled) return;
            this._saveInstalled = true;
            window.addEventListener('danger-confirm-save-back', () => this._saveBackToTemplate());
            window.addEventListener('save-as-template-confirm', (e) => {
                const name = (e && e.detail && e.detail.name) || '';
                this._saveAsNewTemplate(name);
            });
        },

        async _saveBackToTemplate() {
            const templateId = this.form.templateId;
            if (!templateId) return;
            const snapshot = this._captureSnapshotFromEditor();
            if (!snapshot) {
                window.dispatchEvent(new CustomEvent('confirm-danger-done'));
                if (typeof window.showToast === 'function') window.showToast('Could not read the editor snapshot', true);
                return;
            }
            try {
                const res = await window.authFetch('/api/inspections/templates/' + templateId, {
                    method:  'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ schema: snapshot }),
                });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error('HTTP ' + res.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
                }
                window.dispatchEvent(new CustomEvent('confirm-danger-done'));
                if (typeof window.showToast === 'function') window.showToast('Template updated', false);
            } catch (e) {
                window.dispatchEvent(new CustomEvent('confirm-danger-done'));
                if (typeof window.showToast === 'function') window.showToast('Save back failed: ' + ((e && e.message) || 'unknown'), true);
            }
        },

        async _saveAsNewTemplate(name) {
            const cleanName = (name || '').trim();
            if (!cleanName) {
                window.dispatchEvent(new CustomEvent('save-as-template-done'));
                return;
            }
            const snapshot = this._captureSnapshotFromEditor();
            if (!snapshot) {
                window.dispatchEvent(new CustomEvent('save-as-template-done'));
                if (typeof window.showToast === 'function') window.showToast('Could not read the editor snapshot', true);
                return;
            }
            try {
                const res = await window.authFetch('/api/inspections/templates', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ name: cleanName, schema: snapshot }),
                });
                if (!res.ok) {
                    const txt = await res.text();
                    throw new Error('HTTP ' + res.status + (txt ? ' — ' + txt.slice(0, 200) : ''));
                }
                const j = await res.json();
                const newId = j?.data?.template?.id || '';
                window.dispatchEvent(new CustomEvent('save-as-template-done'));
                if (typeof window.showToast === 'function') window.showToast('Saved as new template "' + cleanName + '"', false);
                // Optionally refresh the templates list so the new one appears.
                if (newId) this.templates.push({ id: newId, name: cleanName });
            } catch (e) {
                window.dispatchEvent(new CustomEvent('save-as-template-done'));
                if (typeof window.showToast === 'function') window.showToast('Save as new failed: ' + ((e && e.message) || 'unknown'), true);
            }
        },

        async _doRatingSwitch(mode) {
            const newId = this._pendingRatingSwitchId;
            if (!newId) return;
            this.saveState = 'saving';
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId + '/switch-rating-system', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ratingSystemId: newId, mode }),
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const j = await res.json();
                const stats = (j && j.data) || { remapped: 0, cleared: 0, total: 0 };
                this._lastConfirmedRatingSystemId = newId;
                this.saveState = 'saved';
                if (typeof window.showToast === 'function') {
                    const verb = mode === 'clear'
                        ? stats.cleared + ' ratings cleared'
                        : stats.remapped + ' remapped, ' + stats.cleared + ' cleared';
                    window.showToast('Rating system switched — ' + verb + ' (of ' + stats.total + ').', false);
                }
                // Hard reload so editor + viewer rebuild from the new snapshot.
                window.location.reload();
            } catch (e) {
                this.saveState = 'error';
                window.dispatchEvent(new CustomEvent('rating-switch-done')); // close modal
                if (typeof window.showToast === 'function') {
                    window.showToast('Switch failed: ' + ((e && e.message) || 'unknown'), true);
                }
            }
        },

        async save() {
            this.saveState = 'saving';
            try {
                const body = {
                    date: this.form.date ? new Date(this.form.date + 'T00:00:00').toISOString() : undefined,
                    inspectorId: this.form.inspectorId || undefined,
                    price: Number(this.form.price || 0),
                    paymentRequired: !!this.form.paymentRequired,
                    agreementRequired: !!this.form.agreementRequired,
                    // Round-2 backlog G2 / G3 — null clears, undefined leaves
                    // existing value untouched. Empty string from the date /
                    // text inputs is treated as "clear".
                    closingDate:    this.form.closingDate    || null,
                    orderId:        this.form.orderId        || null,
                    referralSource: this.form.referralSource || null,
                };
                Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
                const res = await window.authFetch('/api/inspections/' + this.inspectionId, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
                this.saveState = res.ok ? 'saved' : 'error';
                if (res.ok) {
                    setTimeout(() => { if (this.saveState === 'saved') this.saveState = 'idle'; }, 2000);
                }
            } catch (e) {
                console.error('settings.save failed', e);
                this.saveState = 'error';
            }
        },
    }));
});
