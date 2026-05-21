// Design-alignment B+C — envelope audit factory, replacing the retired
// /inspections/:id/signatures sub-tab. Mounted inside PublishModal as a
// collapsible block that lists every agreement envelope tied to this
// inspection plus its tamper-evident audit chain.
//
// Driven by inspection-edit.js setting `inspectionId` on the Alpine data
// scope via x-data; the factory takes the id as the first arg, same
// shape as the photo-gallery sheet.

document.addEventListener('alpine:init', () => {
    Alpine.data('envelopeAudit', (inspectionId) => ({
        inspectionId,
        open: false,
        loading: false,
        loaded: false,
        envelopes: [],

        toggle() {
            this.open = !this.open;
            if (this.open && !this.loaded) this.load();
        },

        async load() {
            this.loading = true;
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId + '/agreements');
                if (!res.ok) return;
                const j = await res.json();
                const list = (j.data && j.data.requests) || j.data || [];
                const envelopes = await Promise.all(list.map(async (env) => {
                    let events = [];
                    if (env.id) {
                        try {
                            const r2 = await fetch('/api/public/verify/' + env.id + '/audit-trail');
                            if (r2.ok) {
                                const blob = await r2.json();
                                events = (blob.events || []).map((e) => ({
                                    event: e.event,
                                    createdAtUtc: new Date(e.createdAt).toISOString(),
                                    hash: e.hash,
                                }));
                            }
                        } catch (_e) { /* audit trail is optional */ }
                    }
                    return {
                        id: env.id,
                        token: env.token,
                        agreementName: env.agreementName || (env.agreement && env.agreement.name) || 'Agreement',
                        clientEmail: env.clientEmail || '',
                        status: env.status || 'pending',
                        events,
                    };
                }));
                this.envelopes = envelopes;
                this.loaded = true;
            } catch (e) {
                console.error('envelopeAudit.load failed', e);
            } finally {
                this.loading = false;
            }
        },
    }));
});
