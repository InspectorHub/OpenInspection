// Design System 0520 subsystem B phase 6 task 6.2 — ProgressStrip factory.
//
// Lives inside the inspectionEditor Alpine scope so it can reach
// `$root.sections` + `$root.results` for derivation. Refreshes on a
// 1s interval — cheap for typical (~150-item) inspections; can move
// to event-driven later by dispatching `items-updated` from
// inspection-edit.js when rate/notes change.
//
// What the strip exposes (matches the inspector-app design kit):
//   - completion {rated, total, percent}      — donut + counts text
//   - etaMin                                  — projected minutes left
//   - tally {def, mon, sat, ni, np, other,
//            unrated}                         — pill chips
//   - workflow {agreement, payment}           — Agreement / Payment chips
//                                                (sourced from inspection row)

import { computeCompletion, etaMinutes, tallyByRating } from '/js/progress-strip-helpers.js';

window.progressStrip = function () {
    return {
        completion: { rated: 0, total: 0, percent: 0 },
        etaMin: 0,
        tally:   { def: 0, mon: 0, sat: 0, ni: 0, np: 0, other: 0, unrated: 0 },
        workflow: {
            agreement: { state: 'idle',  label: '—',      tone: 'idle'    },
            payment:   { state: 'idle',  label: '—',      tone: 'idle'    },
        },
        _timer: null,

        init() {
            this.refresh();
            this._timer = setInterval(() => this.refresh(), 1000);
        },

        destroy() {
            if (this._timer) clearInterval(this._timer);
            this._timer = null;
        },

        refresh() {
            // Locate the inspectionEditor scope walking up the DOM. The
            // ProgressStrip is mounted inside the editor's x-data, so its
            // root data is the inspectionEditor() return object.
            const editor = this._editor();
            if (!editor) return;

            const items = this._flatItems(editor);
            this.completion = computeCompletion(items);
            this.etaMin     = etaMinutes(editor._itemDurationsSec ?? [], this.completion.total - this.completion.rated);
            this.tally      = tallyByRating(items);

            // Derive Agreement + Payment chip state from the editor's
            // inspection row. The design kit pairs them up next to the
            // tally chips at the top of the strip — chip tone is the
            // canonical traffic-light convention so users can scan in <1s.
            const insp = editor.inspection || {};
            this.workflow = {
                agreement: this._agreementState(insp),
                payment:   this._paymentState(insp),
            };
        },

        _agreementState(insp) {
            if (!insp.agreementRequired) return { state: 'not-required', label: 'Not required', tone: 'idle' };
            if (insp.agreementSignedAt || insp.signed)  return { state: 'signed',  label: 'Signed',  tone: 'ok'      };
            return { state: 'pending', label: 'Pending', tone: 'watch' };
        },

        _paymentState(insp) {
            if (!insp.paymentRequired)              return { state: 'not-required', label: 'Not required', tone: 'idle'  };
            if (insp.paymentStatus === 'paid')      return { state: 'paid',         label: 'Paid',         tone: 'ok'    };
            return { state: 'unpaid', label: 'Unpaid', tone: 'bad' };
        },

        _editor() {
            // Bubble through the Alpine roots — the ProgressStrip <div> is a
            // descendant of <div x-data="inspectionEditor(...)">. Cache the
            // resolved root on first lookup.
            if (this._editorCache) return this._editorCache;
            const el = document.querySelector('[x-data^="inspectionEditor"]');
            if (!el || !window.Alpine?.$data) return null;
            this._editorCache = window.Alpine.$data(el);
            return this._editorCache;
        },

        _flatItems(editor) {
            const sections = editor.sections || editor.template?.sections || [];
            const results = editor.results || {};
            const out = [];
            for (const sec of sections) {
                const items = sec.items || [];
                for (const it of items) {
                    out.push({
                        id:        it.id,
                        sectionId: sec.id ?? sec.title ?? '',
                        rating:    results[it.id]?.rating ?? null,
                    });
                }
            }
            return out;
        },
    };
};
