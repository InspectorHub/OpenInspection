// Settings → Automations → Attention Rules — handoff-decisions §1.
// Three configurable thresholds (in hours) controlling when items show up
// in the dashboard "Needs Attention" bucket.

(function () {
    const DEFAULTS = { agreement_unsigned_h: 72, invoice_overdue_h: 72, report_unpublished_h: 72 };
    const ROWS = [
        { key: 'agreement_unsigned_h', label: 'Agreement still unsigned',  help: 'Hours since the inspection was booked without a signed agreement.' },
        { key: 'invoice_overdue_h',    label: 'Invoice past due',           help: 'Hours past the invoice due date with no payment recorded.' },
        { key: 'report_unpublished_h', label: 'Report not published yet',   help: 'Hours since inspection completed without the report going out.' },
    ];

    function register() {
        if (!window.Alpine) return;
        Alpine.data('attentionRules', () => ({
            rows: ROWS,
            values: { ...DEFAULTS },
            original: { ...DEFAULTS },
            loading: true,
            saving: false,
            saved: false,
            saveError: '',

            async init() {
                try {
                    const res = await authFetch('/api/admin/attention-thresholds');
                    if (res.ok) {
                        const json = await res.json();
                        if (json?.data?.thresholds) {
                            this.values = { ...DEFAULTS, ...json.data.thresholds };
                            this.original = { ...this.values };
                        }
                    }
                } catch (e) {
                    console.warn('[attention-rules] load failed', e);
                } finally {
                    this.loading = false;
                }
            },

            get dirty() {
                return ROWS.some(r => Number(this.values[r.key]) !== Number(this.original[r.key]));
            },

            onInput(key, raw) {
                const n = parseInt(raw, 10);
                this.values[key] = Number.isFinite(n) ? n : this.original[key];
                this.saved = false;
                this.saveError = '';
            },

            resetDefaults() {
                this.values = { ...DEFAULTS };
            },

            async save() {
                // Clamp to 1..720 client-side; server enforces too.
                const body = {};
                for (const r of ROWS) {
                    let n = Number(this.values[r.key]);
                    if (!Number.isFinite(n) || n < 1) n = 1;
                    if (n > 720) n = 720;
                    body[r.key] = n;
                }
                this.saving = true;
                this.saveError = '';
                try {
                    const res = await authFetch('/api/admin/attention-thresholds', {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    if (!res.ok) {
                        const j = await res.json().catch(() => null);
                        throw new Error(j?.error?.message || ('HTTP ' + res.status));
                    }
                    this.values = { ...body };
                    this.original = { ...body };
                    this.saved = true;
                    setTimeout(() => { this.saved = false; }, 2500);
                } catch (e) {
                    this.saveError = e instanceof Error ? e.message : 'Failed to save';
                } finally {
                    this.saving = false;
                }
            },
        }));
    }

    if (window.Alpine) register();
    else document.addEventListener('alpine:init', register);
})();
