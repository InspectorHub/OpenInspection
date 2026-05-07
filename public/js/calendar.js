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
