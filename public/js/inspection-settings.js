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
        form: {
            date: '',
            inspectorId: '',
            templateId: '',
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
                const [inspRes, tplRes, teamRes, peopleRes, factsRes] = await Promise.all([
                    window.authFetch('/api/inspections/' + this.inspectionId),
                    window.authFetch('/api/templates'),
                    window.authFetch('/api/team/members'),
                    // Round-2 F3 — People card payload.
                    window.authFetch('/api/inspections/' + this.inspectionId + '/people'),
                    // Round-2 backlog G1 — Property Facts strip.
                    window.authFetch('/api/inspections/' + this.inspectionId + '/property-facts'),
                ]);
                const inspJson = inspRes.ok ? await inspRes.json() : { data: {} };
                const insp = (inspJson.data && (inspJson.data.inspection || inspJson.data)) || {};
                this.form.date = (insp.date || '').slice(0, 10);
                this.form.inspectorId = insp.inspectorId || '';
                this.form.templateId = insp.templateId || '';
                this.form.price = Number(insp.price || 0);
                this.form.paymentRequired = !!insp.paymentRequired;
                this.form.agreementRequired = !!insp.agreementRequired;
                // G2 / G3 round-trip — fields may be null on legacy rows.
                this.form.closingDate    = insp.closingDate    || '';
                this.form.orderId        = insp.orderId        || '';
                this.form.referralSource = insp.referralSource || '';

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
