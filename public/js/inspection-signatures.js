// Sprint 2 S2-5 — Signatures sub-page Alpine data factory.
// Lists every agreement_request envelope linked to this inspection plus
// the e-sign audit chain timeline.

document.addEventListener('alpine:init', () => {
    Alpine.data('inspectionSignaturesPage', (inspectionId) => ({
        inspectionId,
        loading: true,
        envelopes: [],

        async load() {
            try {
                const res = await window.authFetch('/api/inspections/' + this.inspectionId + '/agreements');
                if (!res.ok) { this.loading = false; return; }
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
                        } catch (_e) { /* audit trail optional */ }
                    }
                    return {
                        id: env.id,
                        token: env.token,
                        agreementName: env.agreementName || env.agreement?.name || 'Agreement',
                        clientEmail: env.clientEmail || '',
                        status: env.status || 'pending',
                        events,
                    };
                }));
                this.envelopes = envelopes;
            } catch (e) {
                console.error('signatures.load failed', e);
            } finally {
                this.loading = false;
            }
        },
    }));
});
