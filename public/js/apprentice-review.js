/**
 * Apprentice review queue — Alpine factory.
 *
 * Wires the /apprentice-review HTML page to:
 *   GET  /api/team/apprentice-reviews
 *   POST /api/team/apprentice-reviews/:id/decide
 *
 * Each item ships from the server with the apprentice's name + the
 * inspection's property address already joined in, so this factory does
 * not need follow-up fetches to render the queue.
 *
 * State machine: items[] is the union of currently-pending rows + ones
 * the mentor has already decided in this session. Decided rows stay in
 * the list with a `decision` tag so the mentor can see their progress
 * without items disappearing mid-flow.
 */
(function () {
    var RATING_LABELS = {
        SAT: 'Satisfactory',
        sat: 'Satisfactory',
        S:   'Satisfactory',
        MON: 'Monitor',
        mon: 'Monitor',
        M:   'Monitor',
        DEF: 'Defect',
        def: 'Defect',
        D:   'Defect',
        NI:  'Not inspected',
        ni:  'Not inspected',
        NP:  'Not present',
        np:  'Not present',
    };
    var RATING_PILL = {
        SAT: 'ih-pill--sat',
        sat: 'ih-pill--sat',
        S:   'ih-pill--sat',
        MON: 'ih-pill--monitor',
        mon: 'ih-pill--monitor',
        M:   'ih-pill--monitor',
        DEF: 'ih-pill--defect',
        def: 'ih-pill--defect',
        D:   'ih-pill--defect',
        NI:  'ih-pill--ni',
        ni:  'ih-pill--ni',
        NP:  'ih-pill--np',
        np:  'ih-pill--np',
    };

    function parseValue(jsonText) {
        if (!jsonText) return null;
        try { return JSON.parse(jsonText); } catch (_e) { return jsonText; }
    }

    function ratingCode(v) {
        var parsed = parseValue(v);
        if (typeof parsed === 'string') return parsed.toUpperCase();
        if (parsed && typeof parsed === 'object' && parsed.rating) return String(parsed.rating).toUpperCase();
        return '—';
    }

    function relTime(epochSec) {
        if (!epochSec) return '—';
        var diff = Math.floor(Date.now() / 1000) - Number(epochSec);
        if (diff < 60)      return 'just now';
        if (diff < 3600)    return Math.round(diff / 60)    + ' min ago';
        if (diff < 86400)   return Math.round(diff / 3600)  + ' h ago';
        if (diff < 604800)  return Math.round(diff / 86400) + ' d ago';
        return new Date(Number(epochSec) * 1000).toLocaleDateString();
    }

    function initials(name) {
        if (!name) return '?';
        var parts = String(name).trim().split(/\s+/);
        if (parts.length === 1) return (parts[0][0] || '?').toUpperCase();
        return ((parts[0][0] || '') + (parts[parts.length - 1][0] || '')).toUpperCase();
    }

    function shortAddress(addr) {
        if (!addr) return '';
        // Take everything before the first comma — `14 Maple Lane, Apt 4B,
        // San Francisco, CA` → `14 Maple Lane`. Mirrors the design's
        // "first two words" hint without truncating mid-word.
        var comma = String(addr).indexOf(',');
        return comma > 0 ? String(addr).slice(0, comma) : String(addr);
    }

    function apprenticeReview() {
        return {
            loading:     true,
            allItems:    [],
            activeId:    null,
            editing:     false,
            editedValue: '',
            deciding:    false,

            get pendingCount() {
                return this.allItems.filter(function (i) { return !i.decision; }).length;
            },
            get doneCount() {
                return this.allItems.filter(function (i) { return !!i.decision; }).length;
            },
            get active() {
                return this.allItems.find(function (i) { return i.id === this.activeId; }, this) || null;
            },
            get metaText() {
                if (this.loading)              return 'Loading…';
                if (this.allItems.length === 0) return 'Nothing to review';
                return this.pendingCount + ' pending · ' + this.doneCount + ' decided';
            },
            get bannerHeadline() {
                if (this.pendingCount === 0) {
                    return 'All ' + this.allItems.length + ' apprentice ratings reviewed';
                }
                return this.pendingCount + ' apprentice rating' + (this.pendingCount === 1 ? '' : 's') + ' awaiting your review';
            },

            initials:     initials,
            relTime:      relTime,
            shortAddress: shortAddress,

            ratingShort: function (raw) {
                var code = ratingCode(raw);
                return code.length > 3 ? code.slice(0, 3) : code;
            },
            ratingLabel: function (raw) {
                var code = ratingCode(raw);
                return RATING_LABELS[code] || RATING_LABELS[code.toLowerCase()] || code;
            },
            ratingPill: function (raw) {
                var code = ratingCode(raw);
                return RATING_PILL[code] || RATING_PILL[code.toLowerCase()] || 'ih-pill--gen';
            },
            renderValue: function (raw) {
                var parsed = parseValue(raw);
                if (parsed === null || parsed === undefined) return '(empty)';
                if (typeof parsed === 'string') return parsed;
                return JSON.stringify(parsed, null, 2);
            },

            async init() {
                this.loading = true;
                try {
                    const r = await fetch('/api/team/apprentice-reviews', { credentials: 'same-origin' });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    const body = await r.json();
                    this.allItems = (body?.data?.items || []).map(function (it) {
                        // Normalise the server's snake/camel shape and stash a
                        // null decision tag the queue list watches for the
                        // "Approved/Rejected/Edited" pill.
                        return Object.assign({}, it, { decision: null });
                    });
                    if (this.allItems.length > 0) {
                        this.activeId = this.allItems[0].id;
                    }
                } catch (_e) {
                    this.allItems = [];
                } finally {
                    this.loading = false;
                }
            },

            setActive(id) {
                if (this.editing) {
                    if (!confirm('Discard unsaved edit?')) return;
                    this.editing = false;
                    this.editedValue = '';
                }
                this.activeId = id;
            },

            startEdit() {
                if (!this.active || this.active.field === 'rating') return;
                if (this.editing) {
                    // 2nd click of "Save & approve" — submit as edited with the buffered value.
                    return this.decide('edited');
                }
                this.editing     = true;
                this.editedValue = this.renderValue(this.active.proposedValue);
            },

            async decide(action) {
                if (!this.active || this.deciding) return;
                this.deciding = true;
                const id = this.active.id;
                const body = { action: action };
                if (action === 'edited') {
                    body.decisionValue = this.editedValue;
                }
                try {
                    const r = await fetch('/api/team/apprentice-reviews/' + id + '/decide', {
                        method:      'POST',
                        headers:     { 'content-type': 'application/json' },
                        body:        JSON.stringify(body),
                        credentials: 'same-origin',
                    });
                    if (!r.ok) throw new Error('HTTP ' + r.status);
                    // Tag the row with its decision and advance to the next
                    // undecided one — matches the design's auto-progress behavior.
                    const row = this.allItems.find(function (i) { return i.id === id; });
                    if (row) row.decision = action;
                    this.editing     = false;
                    this.editedValue = '';
                    const next = this.allItems.find(function (i) { return !i.decision; });
                    if (next) this.activeId = next.id;
                } catch (_e) {
                    alert('Could not record decision. Please retry.');
                } finally {
                    this.deciding = false;
                }
            },
        };
    }

    if (typeof window !== 'undefined') {
        window.apprenticeReview = apprenticeReview;
        document.addEventListener('alpine:init', function () {
            if (window.Alpine && typeof window.Alpine.data === 'function') {
                window.Alpine.data('apprenticeReview', apprenticeReview);
            }
        });
    }
})();
