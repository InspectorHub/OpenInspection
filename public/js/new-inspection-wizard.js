// Design System 0520 subsystem B phase 5 task 5.4 — NewInspectionWizard
// Alpine factory.
//
// Drives the 4-step state machine + per-step validation + POST submit.
// Roster is lazy-loaded once on init() from /api/team/members (graceful
// no-op if endpoint absent — Team step shows "No team members yet").
//
// Listens to `open-new-inspection-wizard` window event so the dashboard
// "+ New Inspection" button can dispatch without an Alpine ref hookup.

window.newInspectionWizard = function () {
    return {
        open: false,
        step: 1,
        property: { address: '', yearBuilt: null, sqft: null, propertyType: '', commercialSubtype: '' },
        services: ['general'],
        schedule: { date: '', startTime: '09:00', durationMinutes: 180 },
        teamMode: false,
        leadInspectorId: '',
        helperInspectorIds: [],
        roster: [],
        submitting: false,

        async init() {
            window.addEventListener('open-new-inspection-wizard', () => this.openWizard());
            await this.loadRoster();
        },

        async loadRoster() {
            try {
                const r = await fetch('/api/team/members', { credentials: 'same-origin' });
                if (!r.ok) return;
                const body = await r.json();
                const members = (body && body.data && body.data.members) || [];
                this.roster = Array.isArray(members) ? members : [];
            } catch {
                this.roster = [];
            }
        },

        openWizard() {
            this.open = true;
            this.step = 1;
            this.property = { address: '', yearBuilt: null, sqft: null, propertyType: '', commercialSubtype: '' };
            this.services = ['general'];
            this.schedule = { date: '', startTime: '09:00', durationMinutes: 180 };
            this.teamMode = false;
            this.leadInspectorId = '';
            this.helperInspectorIds = [];
        },

        cancel() {
            this.open = false;
        },

        next() {
            if (this.step === 1) {
                if (!this.property.address || this.property.address.trim().length < 3) {
                    if (typeof showToast === 'function') showToast('Address required');
                    else alert('Address required');
                    return;
                }
            }
            if (this.step === 2) {
                if (!Array.isArray(this.services) || this.services.length === 0) {
                    if (typeof showToast === 'function') showToast('Select at least one service');
                    else alert('Select at least one service');
                    return;
                }
            }
            if (this.step === 3) {
                if (!this.schedule.date || !/^\d{4}-\d{2}-\d{2}$/.test(this.schedule.date)) {
                    if (typeof showToast === 'function') showToast('Date required');
                    else alert('Date required');
                    return;
                }
                if (!this.schedule.startTime || !/^\d{2}:\d{2}$/.test(this.schedule.startTime)) {
                    if (typeof showToast === 'function') showToast('Start time required');
                    else alert('Start time required');
                    return;
                }
            }
            this.step++;
        },

        async submit() {
            if (this.submitting) return;
            this.submitting = true;
            try {
                const payload = {
                    property: {
                        address: this.property.address.trim(),
                    },
                    services: this.services,
                    schedule: this.schedule,
                    teamMode: !!this.teamMode,
                };
                if (this.property.yearBuilt) payload.property.yearBuilt = this.property.yearBuilt;
                if (this.property.sqft)      payload.property.sqft = this.property.sqft;
                if (this.property.propertyType) payload.property.propertyType = this.property.propertyType;
                if (this.property.propertyType === 'commercial' && this.property.commercialSubtype) {
                    payload.property.commercialSubtype = this.property.commercialSubtype;
                }
                if (this.teamMode) {
                    if (this.leadInspectorId)        payload.leadInspectorId = this.leadInspectorId;
                    if (this.helperInspectorIds?.length) payload.helperInspectorIds = this.helperInspectorIds;
                }

                const r = await fetch('/api/inspections/wizard', {
                    method:  'POST',
                    headers: { 'content-type': 'application/json' },
                    body:    JSON.stringify(payload),
                    credentials: 'same-origin',
                });
                if (!r.ok) {
                    let msg = String(r.status);
                    try { const body = await r.json(); msg = body?.error?.message ?? msg; } catch { /* swallow */ }
                    if (typeof showToast === 'function') showToast(`Create failed: ${msg}`);
                    else alert(`Create failed: ${msg}`);
                    return;
                }
                const body = await r.json();
                const id = body?.data?.id;
                if (id) {
                    window.location.href = `/inspections/${id}/edit`;
                } else {
                    this.open = false;
                }
            } finally {
                this.submitting = false;
            }
        },
    };
};
