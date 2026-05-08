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

document.addEventListener('DOMContentLoaded', function() {
    var calendarEl = document.getElementById('calendar');
    if (!calendarEl) return;
    if (typeof FullCalendar === 'undefined') {
        console.error('FullCalendar not loaded');
        return;
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
