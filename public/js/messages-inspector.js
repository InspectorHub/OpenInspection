// Phase T (T23) — Inspector Messages panel Alpine data
function messagesInspector(inspectionId) {
    return {
        inspectionId,
        open: false,
        messages: [],
        token: '',
        composeBody: '',
        pendingAttachments: [],
        sending: false,

        get publicLink() {
            return this.token ? (location.origin + '/messages/' + this.token) : '';
        },

        async init() {
            await this.fetch();
            setInterval(() => { if (this.open) this.fetch(); }, 30000);
        },

        async fetch() {
            try {
                const r = await authFetch('/api/messages/inspections/' + encodeURIComponent(this.inspectionId));
                if (!r.ok) return;
                const d = await r.json();
                this.messages = d.data || [];
                this.token = d.meta?.token || '';
            } catch { /* silent */ }
        },

        async upload(files) {
            for (const f of files) {
                const fd = new FormData();
                fd.append('file', f);
                try {
                    const r = await authFetch('/api/messages/inspections/' + encodeURIComponent(this.inspectionId) + '/upload', { method: 'POST', body: fd });
                    if (r.ok) {
                        const d = await r.json();
                        this.pendingAttachments.push(d.data);
                    }
                } catch { /* silent */ }
            }
        },

        async send() {
            if (!this.composeBody || this.sending) return;
            this.sending = true;
            try {
                const r = await authFetch('/api/messages/inspections/' + encodeURIComponent(this.inspectionId), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ body: this.composeBody, attachments: this.pendingAttachments }),
                });
                if (r.ok) {
                    this.composeBody = '';
                    this.pendingAttachments = [];
                    await this.fetch();
                }
            } finally {
                this.sending = false;
            }
        },
    };
}
