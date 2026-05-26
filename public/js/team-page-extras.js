/**
 * Design System 0520 subsystem C P10.1 — Alpine factories for the
 * three new sections on /team (Defaults, Apprentices, Active Guests).
 *
 * Backend endpoints land in P10.2:
 *   GET  /api/team/defaults
 *   PUT  /api/team/defaults
 *   GET  /api/team/apprentices
 *   GET  /api/team/guests
 *   POST /api/team/guests/:id/revoke
 *
 * Each factory is registered both via Alpine.data (for x-data="…()" auto
 * resolution) and as a window-global function so inline markup works
 * before alpine:init fires.
 */
(function () {
    function relExpiry(epochSeconds) {
        if (!epochSeconds) return '—';
        const diff = epochSeconds - Math.floor(Date.now() / 1000);
        if (diff <= 0)             return 'expired';
        if (diff < 3600)           return `${Math.round(diff / 60)}m`;
        if (diff < 86400)          return `${Math.round(diff / 3600)}h`;
        return `${Math.round(diff / 86400)}d`;
    }

    function teamDefaults() {
        return {
            teamModeDefault:          false,
            apprenticeReviewRequired: false,
            guestInvitesEnabled:      true,
            saving:                   false,

            async init() {
                try {
                    const r = await fetch('/api/team/defaults', { credentials: 'same-origin' });
                    if (!r.ok) return;
                    const body = await r.json();
                    if (body?.data) Object.assign(this, body.data);
                } catch (_e) { /* leave defaults */ }
            },

            async save() {
                this.saving = true;
                try {
                    await fetch('/api/team/defaults', {
                        method:  'PUT',
                        headers: { 'content-type': 'application/json' },
                        body:    JSON.stringify({
                            teamModeDefault:          this.teamModeDefault,
                            apprenticeReviewRequired: this.apprenticeReviewRequired,
                            guestInvitesEnabled:      this.guestInvitesEnabled,
                        }),
                        credentials: 'same-origin',
                    });
                } finally {
                    this.saving = false;
                }
            },
        };
    }

    function teamApprentices() {
        return {
            items:   [],
            loading: true,
            async init() {
                try {
                    const r = await fetch('/api/team/apprentices', { credentials: 'same-origin' });
                    if (r.ok) this.items = (await r.json())?.data ?? [];
                } finally {
                    this.loading = false;
                }
            },
        };
    }

    function teamGuests() {
        return {
            items:   [],
            loading: true,
            async init() {
                try {
                    const r = await fetch('/api/team/guests', { credentials: 'same-origin' });
                    if (r.ok) {
                        const rows = (await r.json())?.data ?? [];
                        this.items = rows.map(g => ({ ...g, expiresRel: relExpiry(g.expiresAt) }));
                    }
                } finally {
                    this.loading = false;
                }
            },
            async revoke(g) {
                if (!confirm(`Revoke guest "${g.name || g.email}" now?`)) return;
                const r = await fetch(`/api/team/guests/${encodeURIComponent(g.id)}/revoke`, {
                    method: 'POST',
                    credentials: 'same-origin',
                });
                if (r.ok) {
                    this.items = this.items.filter(x => x.id !== g.id);
                }
            },
        };
    }

    const register = (name, fn) => {
        if (window.Alpine?.data) window.Alpine.data(name, fn);
        else document.addEventListener('alpine:init', () => window.Alpine.data(name, fn));
        window[name] = fn;
    };
    register('teamDefaults',    teamDefaults);
    register('teamApprentices', teamApprentices);
    register('teamGuests',      teamGuests);
})();
