/**
 * Sprint 3 Track B (S3-2) — Customer Repair Request page (Alpine factory).
 *
 * Owns the state for the public `/inspections/:id/customer-repair-request`
 * export page:
 *   - per-item textarea notes (collected into a single payload before send)
 *   - recipient email input + submit
 *   - toast-style status feedback (success / error)
 *
 * Posts to POST /api/public/repair-request/email; the endpoint mirrors the
 * gating used by `/report/:id` (shared subdomain → same tenant resolution
 * → payment + agreement gate). No JWT required — the page is public.
 */
document.addEventListener('alpine:init', function () {
    window.Alpine.data('customerRepairRequest', function (initial) {
        return {
            inspectionId: initial.inspectionId,
            recipientEmail: initial.recipientEmail || '',
            items: initial.items || [],
            itemNotes: {},
            sending: false,
            toast: '',
            toastError: false,

            init() {
                // Pre-seed itemNotes keys so the payload always contains the
                // same shape (one entry per defect, possibly empty string).
                for (const it of this.items) {
                    if (!Object.prototype.hasOwnProperty.call(this.itemNotes, it.itemId)) {
                        this.itemNotes[it.itemId] = '';
                    }
                }
            },

            buildCustomerComments() {
                // Concatenate the per-item textarea notes into a single
                // human-readable string the backend can attach to the email.
                // Skips empty entries.
                const lines = [];
                for (const it of this.items) {
                    const note = (this.itemNotes[it.itemId] || '').trim();
                    if (!note) continue;
                    const heading = (it.sectionTitle || '') + ' › ' + (it.itemLabel || '');
                    lines.push(heading + ': ' + note);
                }
                return lines.join('\n');
            },

            isValidEmail(s) {
                if (!s) return false;
                // Lightweight client-side check; the server uses Zod email().
                return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s));
            },

            async sendEmail() {
                if (this.sending) return;
                if (!this.isValidEmail(this.recipientEmail)) {
                    this.toast = 'Please enter a valid email address.';
                    this.toastError = true;
                    return;
                }
                this.sending = true;
                this.toast = '';
                this.toastError = false;
                try {
                    const body = {
                        inspectionId: this.inspectionId,
                        recipientEmail: this.recipientEmail,
                        customerComments: this.buildCustomerComments(),
                    };
                    const res = await fetch('/api/public/repair-request/email', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(body),
                    });
                    const json = await res.json().catch(function () { return null; });
                    if (!res.ok || !json || json.success !== true) {
                        const msg = (json && json.error && json.error.message) || 'Email could not be sent.';
                        this.toast = msg;
                        this.toastError = true;
                        return;
                    }
                    this.toast = 'Repair request sent. Check your inbox.';
                    this.toastError = false;
                } catch (err) {
                    this.toast = 'Network error. Please try again.';
                    this.toastError = true;
                } finally {
                    this.sending = false;
                }
            },
        };
    });
});
