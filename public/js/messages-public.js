// Phase T (T24) — Public client messages page Alpine data
function messagesPublic(token) {
    return {
        token,
        messages: [],
        inspection: null,
        composeBody: '',
        pendingAttachments: [],
        sending: false,

        async init() {
            await this.fetch();
            setInterval(() => this.fetch(), 30000);
        },

        async fetch() {
            try {
                const r = await fetch('/api/messages/public/' + encodeURIComponent(this.token));
                if (!r.ok) return;
                const d = await r.json();
                this.messages = d.data || [];
                this.inspection = d.meta?.inspection || null;
            } catch { /* silent */ }
        },

        async upload(files) {
            for (const f of files) {
                const fd = new FormData();
                fd.append('file', f);
                try {
                    const r = await fetch('/api/messages/public/' + encodeURIComponent(this.token) + '/upload', { method: 'POST', body: fd });
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
                const r = await fetch('/api/messages/public/' + encodeURIComponent(this.token), {
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
