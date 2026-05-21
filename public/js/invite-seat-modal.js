/**
 * Design System 0520 subsystem C P5.4 — Alpine factory for InviteSeatModal.
 *
 * Open from any page by dispatching `invite-seat-modal:open` on
 * window after the page mounts. The modal reads team leads + active
 * template sections on init so the apprentice + specialist branches
 * render immediately.
 */
(function () {
    function factory() {
        return {
            open: false,
            mode: 'permanent',
            email: '',
            role: 'lead',
            mentorId: '',
            sectionIds: [],
            durationSeconds: 86400,
            leads: [],
            sections: [],
            generatedUrl: '',
            submitting: false,
            error: '',

            // Caller-supplied label (e.g. "Inspection roster · live add")
            // so audit logs / analytics can tell where the invite came from.
            sourceLabel: '',

            async init() {
                window.addEventListener('invite-seat-modal:open', (e) => {
                    const detail = (e && e.detail) || {};
                    this.openModal({
                        mode:        detail.mode === 'guest' ? 'guest' : 'permanent',
                        sourceLabel: detail.sourceLabel || '',
                    });
                });
                await Promise.all([this.loadLeads(), this.loadSections()]);
            },

            openModal(opts) {
                opts = opts || {};
                this.open         = true;
                this.mode         = opts.mode === 'guest' ? 'guest' : 'permanent';
                this.sourceLabel  = opts.sourceLabel || '';
                this.email        = '';
                this.role         = 'lead';
                this.mentorId     = '';
                this.sectionIds   = [];
                this.generatedUrl = '';
                this.error        = '';
            },

            close() {
                this.open = false;
            },

            async loadLeads() {
                try {
                    const r = await fetch('/api/team/members', { credentials: 'same-origin' });
                    if (!r.ok) return;
                    const body = await r.json();
                    const members = body?.data?.members ?? [];
                    this.leads = members.filter(m => m.role === 'lead' || m.role === 'inspector');
                } catch (_e) { /* swallow — modal still works */ }
            },

            async loadSections() {
                try {
                    const r = await fetch('/api/templates/sections', { credentials: 'same-origin' });
                    if (!r.ok) return;
                    const body = await r.json();
                    this.sections = body?.data?.sections ?? [];
                } catch (_e) { /* swallow — specialist branch gracefully degrades */ }
            },

            // Translate the 402 SEAT_LIMIT_REACHED payload into a confirm
            // prompt + redirect to the billing portal when available.
            async _handleSeatLimit(resp) {
                let body = {};
                try { body = await resp.json(); } catch (_) { /* ignore */ }
                const portal = body?.error?.details?.billingPortalUrl;
                const msg = portal
                    ? 'Team has reached its seat limit. Open billing portal to upgrade?'
                    : 'Team has reached its seat limit. Ask the admin to upgrade.';
                if (portal && confirm(msg)) {
                    window.location.href = portal;
                } else {
                    this.error = 'Team has reached its seat limit.';
                }
            },

            async submitPermanent() {
                this.submitting = true;
                this.error = '';
                try {
                    const payload = {
                        email: this.email,
                        role:  this.role,
                    };
                    if (this.role === 'apprentice') payload.mentorId = this.mentorId;
                    if (this.role === 'specialist') payload.assignedSectionIds = this.sectionIds;

                    const r = await fetch('/api/team/invite', {
                        method:  'POST',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify(payload),
                        credentials: 'same-origin',
                    });
                    if (r.status === 402) { await this._handleSeatLimit(r); return; }
                    if (!r.ok) {
                        const body = await r.json().catch(() => ({}));
                        this.error = body?.error?.message || `Invite failed (${r.status})`;
                        return;
                    }
                    this.close();
                    window.dispatchEvent(new CustomEvent('invite-seat-modal:invited'));
                } catch (_e) {
                    this.error = 'Network error';
                } finally {
                    this.submitting = false;
                }
            },

            async submitGuest() {
                this.submitting = true;
                this.error = '';
                try {
                    const payload = {
                        role:            this.role,
                        durationSeconds: this.durationSeconds,
                    };

                    const r = await fetch('/api/team/guests', {
                        method:  'POST',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify(payload),
                        credentials: 'same-origin',
                    });
                    if (r.status === 402) { await this._handleSeatLimit(r); return; }
                    if (!r.ok) {
                        const body = await r.json().catch(() => ({}));
                        this.error = body?.error?.message || `Generate failed (${r.status})`;
                        return;
                    }
                    const body = await r.json();
                    this.generatedUrl = body?.data?.url ?? '';
                } catch (_e) {
                    this.error = 'Network error';
                } finally {
                    this.submitting = false;
                }
            },

            copy(text) {
                if (navigator.clipboard?.writeText) {
                    navigator.clipboard.writeText(text);
                }
            },
        };
    }

    // Register against Alpine when ready, else queue for alpine:init.
    // Also expose as a window-global so inline `x-data="inviteSeatModal()"`
    // resolves even before the Alpine.data registration fires (Alpine
    // falls back to window globals when the name isn't a registered
    // factory). Matches feedback_alpine_register_timing.
    if (window.Alpine?.data) window.Alpine.data('inviteSeatModal', factory);
    else document.addEventListener('alpine:init', () => window.Alpine.data('inviteSeatModal', factory));
    window.inviteSeatModal = factory;
})();
