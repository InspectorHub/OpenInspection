// ─── Sub-spec B Task 3 — PageHeader meta ────────────────────────────────────
function calendarMeta() {
    return {
        weekCount: 0,
        nextOpen:  '',
        get metaText() {
            const parts = [];
            if (this.weekCount > 0) parts.push(this.weekCount + ' this week');
            else parts.push('No inspections scheduled this week');
            if (this.nextOpen) parts.push('next open ' + this.nextOpen);
            return parts.join(' · ');
        },
        async init() {
            try {
                const now = new Date();
                const start = now.toISOString().slice(0, 10);
                const end = new Date(now.getTime() + 7 * 86400 * 1000).toISOString().slice(0, 10);
                const r = await authFetch('/api/inspections?from=' + start + '&to=' + end + '&limit=200');
                if (!r.ok) return;
                const j = await r.json();
                const list = j.data?.inspections || [];
                this.weekCount = list.length;
            } catch {}
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('calendarMeta', calendarMeta));
window.calendarMeta = calendarMeta;

// ─── Sprint 3 · S3-9 — Drag-drop reschedule helpers ─────────────────────────
//
// Pure helpers mirrored from src/lib/calendar-conflict.ts so the browser can
// run them without bundling. The TS unit tests cover the canonical version;
// keep this in sync when changing the algorithm.
//
// `sameDayHour` matches if both inputs fall on the same UTC calendar day and
// the same UTC hour. YYYY-MM-DD inputs are treated as full-day occupants.

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function calendarSameDayHour(a, b) {
    if (!a || !b) return false;
    const aDateOnly = DATE_ONLY_RE.test(a);
    const bDateOnly = DATE_ONLY_RE.test(b);
    const aDate = aDateOnly ? new Date(a + 'T00:00:00Z') : new Date(a);
    const bDate = bDateOnly ? new Date(b + 'T00:00:00Z') : new Date(b);
    if (Number.isNaN(aDate.getTime()) || Number.isNaN(bDate.getTime())) return false;
    const sameDay = aDate.getUTCFullYear() === bDate.getUTCFullYear()
        && aDate.getUTCMonth() === bDate.getUTCMonth()
        && aDate.getUTCDate()  === bDate.getUTCDate();
    if (!sameDay) return false;
    if (aDateOnly || bDateOnly) return true;
    return aDate.getUTCHours() === bDate.getUTCHours();
}

function findConflict(events, targetIso, ignoreId) {
    for (const ev of events) {
        if (!ev || ev.id === ignoreId) continue;
        // Skip Google read-only events — they aren't ours to bump.
        if (ev.extendedProps && ev.extendedProps.source === 'google') continue;
        const evIso = typeof ev.startStr === 'string' && ev.startStr
            ? ev.startStr
            : (ev.start instanceof Date ? ev.start.toISOString() : ev.start);
        if (calendarSameDayHour(evIso, targetIso)) return ev;
    }
    return null;
}

function formatSlotLabel(iso) {
    if (!iso) return '';
    const d = DATE_ONLY_RE.test(iso) ? new Date(iso + 'T00:00:00Z') : new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    if (DATE_ONLY_RE.test(iso)) {
        return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
    }
    return d.toLocaleString(undefined, {
        weekday: 'short', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit',
    });
}

// PATCH helper. Returns {ok: boolean, status: number}
async function patchInspectionDate(id, newIso) {
    try {
        const res = await authFetch('/api/inspections/' + encodeURIComponent(id), {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: newIso }),
        });
        return { ok: res.ok, status: res.status };
    } catch (err) {
        return { ok: false, status: 0 };
    }
}

// ─── Sprint 3 · S3-9 — Conflict modal Alpine data ───────────────────────────
function calendarConflict() {
    return {
        open:          false,
        busy:          false,
        conflictTitle: '',
        targetLabel:   '',
        // Pending drop context — populated when the modal opens.
        _draggedId:    null,
        _draggedOldIso:null,
        _draggedNewIso:null,
        _conflictId:   null,
        _conflictIso:  null,
        _revert:       null,
        _onResolved:   null,

        prompt(payload) {
            this._draggedId     = payload.draggedId;
            this._draggedOldIso = payload.draggedOldIso;
            this._draggedNewIso = payload.draggedNewIso;
            this._conflictId    = payload.conflictId;
            this._conflictIso   = payload.conflictIso;
            this._revert        = payload.revert;
            this._onResolved    = payload.onResolved;
            this.conflictTitle  = payload.conflictTitle || 'Another inspection';
            this.targetLabel    = formatSlotLabel(payload.draggedNewIso);
            this.busy           = false;
            this.open           = true;
        },

        cancel() {
            if (this.busy) return;
            try { if (this._revert) this._revert(); } catch {}
            this._reset();
            this.open = false;
        },

        async resolve(action) {
            if (this.busy) return;
            this.busy = true;

            // Replace = move conflict back to dragged's old slot.
            // Swap    = move dragged to new slot AND conflict to dragged's old slot.
            // The dragged event has already been visually moved by FullCalendar
            // before eventDrop fires; both branches PATCH it to confirm the move
            // and PATCH the conflict to its new slot.
            const patchDragged  = patchInspectionDate(this._draggedId,  this._draggedNewIso);
            const patchConflict = patchInspectionDate(this._conflictId, this._draggedOldIso);
            const [a, b] = await Promise.all([patchDragged, patchConflict]);

            this.busy = false;
            if (!a.ok || !b.ok) {
                // Roll back: revert the drag. The conflict event's position is
                // controlled by the underlying data, not the drag, so a refetch
                // restores it.
                try { if (this._revert) this._revert(); } catch {}
                if (typeof showToast === 'function') showToast('Reschedule failed', true);
                if (this._onResolved) this._onResolved({ ok: false });
                this._reset();
                this.open = false;
                return;
            }

            if (typeof showToast === 'function') {
                showToast(action === 'swap' ? 'Inspections swapped' : 'Inspection rescheduled');
            }
            if (this._onResolved) this._onResolved({ ok: true, action });
            this._reset();
            this.open = false;
        },

        _reset() {
            this._draggedId = this._draggedOldIso = this._draggedNewIso = null;
            this._conflictId = this._conflictIso = null;
            this._revert = this._onResolved = null;
        },
    };
}
document.addEventListener('alpine:init', () => window.Alpine.data('calendarConflict', calendarConflict));
window.calendarConflict = calendarConflict;

// Export pure helpers on window so the FullCalendar handler (which runs
// outside Alpine) can reuse them, and so manual smoke tests can call them
// from the browser console.
window._calendar = window._calendar || {};
window._calendar.sameDayHour     = calendarSameDayHour;
window._calendar.findConflict    = findConflict;
window._calendar.formatSlotLabel = formatSlotLabel;
window._calendar.patchInspectionDate = patchInspectionDate;

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    if (typeof FullCalendar === 'undefined') {
        console.error('FullCalendar not loaded');
        return;
    }

    // Reach into the conflict modal Alpine data once the modal is mounted.
    function getConflictModal() {
        var el = document.querySelector('[x-data="calendarConflict"]');
        if (!el || !window.Alpine) return null;
        return window.Alpine.$data(el);
    }

    var calendar = new FullCalendar.Calendar(calendarEl, {
        initialView: 'dayGridMonth',
        locale: 'en',
        headerToolbar: {
            left:   'prev,next today',
            center: 'title',
            right:  'dayGridMonth,timeGridWeek,timeGridDay',
        },
        height: 'auto',
        nowIndicator: true,

        // Sprint 3 · S3-9 — drag-drop reschedule.
        editable:              true,
        eventDurationEditable: false,
        // Allow dragging local inspection events; Google events stay read-only.
        eventAllow: function(_dropInfo, draggedEvent) {
            const src = draggedEvent.extendedProps && draggedEvent.extendedProps.source;
            return src !== 'google';
        },
        // Mobile: long-press to start drag. FullCalendar uses Pointer Events
        // under the hood; `longPressDelay` enables press-and-hold drag start
        // on touch devices, matching the iOS/Android home-screen mental model.
        longPressDelay: 500,
        selectLongPressDelay: 500,

        events: function(info, successCallback, failureCallback) {
            authFetch('/api/calendar/events?start=' + encodeURIComponent(info.startStr) + '&end=' + encodeURIComponent(info.endStr))
                .then(function(res) {
                    if (!res.ok) { failureCallback(new Error('Failed to load events')); return; }
                    return res.json();
                })
                .then(function(data) {
                    if (data) successCallback(data);
                })
                .catch(failureCallback);
        },
        eventDrop: async function(info) {
            // Don't accept drops on read-only Google events (also blocked by eventAllow).
            if (info.event.extendedProps && info.event.extendedProps.source === 'google') {
                info.revert();
                return;
            }

            const draggedId      = info.event.id;
            const draggedNewIso  = info.event.start ? info.event.start.toISOString() : null;
            const draggedOldIso  = info.oldEvent && info.oldEvent.start ? info.oldEvent.start.toISOString() : null;

            if (!draggedNewIso) {
                info.revert();
                if (typeof showToast === 'function') showToast('Could not parse new date', true);
                return;
            }

            // Conflict check across currently-rendered events (excluding the
            // dragged event itself).
            const allEvents = calendar.getEvents();
            const conflict  = findConflict(allEvents, draggedNewIso, draggedId);

            if (conflict) {
                const modal = getConflictModal();
                if (!modal) {
                    // Modal markup not present — fall back to revert + toast.
                    info.revert();
                    if (typeof showToast === 'function') showToast('Time slot taken', true);
                    return;
                }
                modal.prompt({
                    draggedId:      draggedId,
                    draggedOldIso:  draggedOldIso,
                    draggedNewIso:  draggedNewIso,
                    conflictId:     conflict.id,
                    conflictIso:    conflict.startStr || (conflict.start && conflict.start.toISOString()),
                    conflictTitle:  conflict.title,
                    revert:         function() { info.revert(); },
                    onResolved:     function(_result) { calendar.refetchEvents(); },
                });
                return;
            }

            // No conflict — optimistic UI: card has already moved. PATCH and
            // snap back on error.
            const result = await patchInspectionDate(draggedId, draggedNewIso);
            if (!result.ok) {
                info.revert();
                if (typeof showToast === 'function') showToast('Reschedule failed', true);
                return;
            }
            if (typeof showToast === 'function') showToast('Inspection rescheduled');
        },
        eventClick: function(info) {
            // Google events are read-only — no navigation
            if (info.event.extendedProps && info.event.extendedProps.source === 'google') {
                info.jsEvent.preventDefault();
                return;
            }
            if (info.event.url) {
                info.jsEvent.preventDefault();
                window.location.href = info.event.url;
            }
        },
        dateClick: function(info) {
            // Click empty slot in week/day view → open New Inspection modal
            // on dashboard. /inspections/new is not a real route — the create
            // form is a modal on /dashboard. Pass date through query string
            // so dashboard.js can pre-fill the date picker.
            if (calendar.view.type === 'dayGridMonth') return;
            window.location.href = '/dashboard?newInspection=1&date=' + encodeURIComponent(info.dateStr);
        },
        eventDidMount: function(info) {
            // Visually distinguish Google events
            if (info.event.extendedProps && info.event.extendedProps.source === 'google') {
                info.el.style.cursor = 'default';
                info.el.style.opacity = '0.7';
            }
        },
    });

    calendar.render();
});
