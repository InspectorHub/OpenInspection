// Sprint 2 S2-5 — Settings sub-page Alpine data factory.
// Edits inspection-level config: schedule, inspector, template, gates.
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
        form: {
            date: '',
            inspectorId: '',
            templateId: '',
            price: 0,
            paymentRequired: false,
            agreementRequired: false,
        },

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
                const [inspRes, tplRes, teamRes, peopleRes] = await Promise.all([
                    window.authFetch('/api/inspections/' + this.inspectionId),
                    window.authFetch('/api/templates'),
                    window.authFetch('/api/team/members'),
                    // Round-2 F3 — People card payload.
                    window.authFetch('/api/inspections/' + this.inspectionId + '/people'),
                ]);
                const inspJson = inspRes.ok ? await inspRes.json() : { data: {} };
                const insp = (inspJson.data && (inspJson.data.inspection || inspJson.data)) || {};
                this.form.date = (insp.date || '').slice(0, 10);
                this.form.inspectorId = insp.inspectorId || '';
                this.form.templateId = insp.templateId || '';
                this.form.price = Number(insp.price || 0);
                this.form.paymentRequired = !!insp.paymentRequired;
                this.form.agreementRequired = !!insp.agreementRequired;

                if (tplRes && tplRes.ok) {
                    const tplJson = await tplRes.json();
                    this.templates = (tplJson.data && (tplJson.data.templates || tplJson.data)) || [];
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
            } catch (e) {
                console.error('settings.load failed', e);
            } finally {
                this.loading = false;
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
                };
                Object.keys(body).forEach(k => body[k] === undefined && delete body[k]);
                const res = await window.authFetch('/api/inspections/' + this.inspectionId, {
                    method: 'PUT',
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
