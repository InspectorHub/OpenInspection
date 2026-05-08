// Sprint 1 Sub-spec C — public booking page Alpine handler.
//
// Owns:
//   * date input validation (R7-06) — uses native <input type="date">; values
//     arrive as ISO "YYYY-MM-DD" strings regardless of OS locale, so we just
//     verify the date is real and not in the past
//   * 4-option time window radio cards (C-6) — morning / afternoon / all-day /
//     custom, with inline time picker for custom
//   * form submit flow with Turnstile token + AddressAutocomplete hidden fields
//
// The legacy `publicBooking` factory (calendar/availability fetch) is retained
// for any other page that still uses it; the booking page itself now uses
// the simpler `bookingPage()` factory below.

document.addEventListener('alpine:init', () => {
    // ─── Sprint 1 page-level data ────────────────────────────────────────────
    Alpine.data('bookingPage', () => ({
        inspectionDate: '',       // ISO "YYYY-MM-DD" from native date input
        dateError:  '',
        selectedWindow: '',
        customTime:  '',
        submitting:  false,
        message:     '',
        messageOk:   false,
        windowOptions: [
            { id: 'morning',   label: 'Morning',   detail: '8:00 AM – 12:00 PM' },
            { id: 'afternoon', label: 'Afternoon', detail: '12:00 PM – 4:00 PM' },
            { id: 'all-day',   label: 'All day',   detail: '8:00 AM – 5:00 PM' },
            { id: 'custom',    label: 'Custom',    detail: 'Pick exact time' },
        ],
        // Sprint 2 S2-2 — multi-inspection per request. The available services
        // section only shows up if the tenant has any active templated services.
        availableServices:    [],
        selectedServiceIds:   [],

        async init() {
            try {
                const res = await fetch('/api/public/services');
                if (res.ok) {
                    const j = await res.json();
                    this.availableServices = (j.data && j.data.services) || [];
                }
            } catch (_e) {
                // Services list is optional — booking works without it.
            }
        },

        get hasServices() { return this.availableServices.length > 0; },
        get totalPriceCents() {
            return this.availableServices
                .filter(s => this.selectedServiceIds.includes(s.id))
                .reduce((sum, s) => sum + (s.price || 0), 0);
        },

        validateDate() {
            this.dateError = '';
            if (!this.inspectionDate) return;
            const m = this.inspectionDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
            if (!m) { this.dateError = 'Please pick a valid date'; return; }
            const year  = parseInt(m[1], 10);
            const month = parseInt(m[2], 10);
            const day   = parseInt(m[3], 10);
            const dt = new Date(year, month - 1, day);
            if (isNaN(dt.getTime()) ||
                dt.getFullYear() !== year ||
                dt.getMonth() !== month - 1 ||
                dt.getDate() !== day) {
                this.dateError = 'Please pick a valid date';
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (dt < today) {
                this.dateError = 'Please pick a date that is not in the past';
            }
        },

        toIsoDate() {
            // Native <input type="date"> already gives us "YYYY-MM-DD".
            const m = (this.inspectionDate || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
            return m ? this.inspectionDate : null;
        },

        async submitBooking() {
            this.message = '';
            this.validateDate();
            if (this.dateError) return;
            const isoDate = this.toIsoDate();
            if (!isoDate) { this.dateError = 'Please pick a valid date'; return; }
            if (!this.selectedWindow) {
                this.message = 'Please pick a time window';
                this.messageOk = false;
                return;
            }
            if (this.selectedWindow === 'custom' && !this.customTime) {
                this.message = 'Please pick a custom time';
                this.messageOk = false;
                return;
            }
            this.submitting = true;
            try {
                const form = document.getElementById('bookingForm');
                const data = new FormData(form);
                const turnstileToken = data.get('cf-turnstile-response') || '';
                const payload = {
                    address:      String(data.get('address') || '').trim(),
                    clientName:   String(data.get('clientName') || '').trim(),
                    clientEmail:  String(data.get('clientEmail') || '').trim(),
                    date:         isoDate,
                    timeSlot:     this.selectedWindow,
                    turnstileToken: turnstileToken || undefined,
                };
                if (this.selectedWindow === 'custom') payload.customTime = this.customTime;
                // Sprint 2 S2-2 — when the customer picked one or more services,
                // include them so the server creates a parent request + N
                // sub-inspections. When empty, the legacy single-service flow
                // still creates a one-inspection request implicitly.
                if (this.selectedServiceIds.length > 0) {
                    payload.services = this.selectedServiceIds.map(id => ({ serviceId: id }));
                }

                const res = await fetch('/api/public/book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (res.ok) {
                    const j = await res.json().catch(() => ({}));
                    const ids = (j.data && j.data.inspectionIds) || [];
                    const count = ids.length || 1;
                    this.message   = count > 1
                        ? count + ' inspections requested — check your email for confirmation.'
                        : 'Inspection requested — check your email for confirmation.';
                    this.messageOk = true;
                    form.reset();
                    this.inspectionDate = '';
                    this.selectedWindow = '';
                    this.customTime = '';
                    this.selectedServiceIds = [];
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                } else {
                    const j = await res.json().catch(() => ({}));
                    this.message   = (j.error && j.error.message) || 'Could not submit your request — please try again.';
                    this.messageOk = false;
                }
            } catch (e) {
                this.message   = 'Network error — please try again.';
                this.messageOk = false;
            } finally {
                this.submitting = false;
            }
        },
    }));

    // ─── Legacy `publicBooking` factory (left intact for other consumers) ───
    Alpine.data('publicBooking', () => ({
        inspectors: [], selectedInspector: null, selectedDate: null, selectedTime: null,
        availableSlots: [], calendarDates: [], currentMonth: new Date(),
        submitting: false, success: false,
        agentId: new URLSearchParams(window.location.search).get('agent') || '',
        form: { propertyAddress: '', clientName: '', clientEmail: '' },
        async init() { this.fetchInspectors(); this.generateCalendar(); },
        async fetchInspectors() {
            const res = await fetch('/api/public/inspectors');
            const response = await res.json();
            this.inspectors = (response.data && response.data.inspectors) || response.inspectors || [];
            if (this.inspectors.length > 0) this.selectInspector(this.inspectors[0]);
        },
        selectInspector(inspector) { this.selectedInspector = inspector; this.selectedDate = null; this.selectedTime = null; this.availableSlots = []; },
        async selectDate(date) { this.selectedDate = date.iso; this.selectedTime = null; this.fetchAvailability(); },
        async fetchAvailability() {
            if (!this.selectedInspector || !this.selectedDate) return;
            const res = await fetch(`/api/public/availability/${this.selectedInspector.id}?date=${this.selectedDate}`);
            const response = await res.json();
            this.availableSlots = (response.data && response.data.slots) || response.slots || [];
            if (this.availableSlots.length === 0) this.availableSlots = ["09:00", "11:00", "14:00", "16:00"];
        },
        generateCalendar() {
            const year = this.currentMonth.getFullYear();
            const month = this.currentMonth.getMonth();
            const firstDay = new Date(year, month, 1);
            const lastDay = new Date(year, month + 1, 0);
            const dates = [];
            const startPadding = firstDay.getDay();
            const today = new Date(); today.setHours(0,0,0,0);
            for (let i = startPadding - 1; i >= 0; i--) { const d = new Date(year, month, -i); dates.push({ day: d.getDate(), iso: d.toISOString().split('T')[0], isCurrentMonth: false, isPast: true }); }
            for (let i = 1; i <= lastDay.getDate(); i++) { const d = new Date(year, month, i); dates.push({ day: i, iso: d.toISOString().split('T')[0], isCurrentMonth: true, isPast: d < today }); }
            this.calendarDates = dates;
        },
        prevMonth() { this.currentMonth.setMonth(this.currentMonth.getMonth() - 1); this.generateCalendar(); },
        nextMonth() { this.currentMonth.setMonth(this.currentMonth.getMonth() + 1); this.generateCalendar(); },
        formatDate(iso) { return new Date(iso).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }); },
        async submitBooking() {
            this.submitting = true;
            try {
                const turnstileToken = document.querySelector('[name="cf-turnstile-response"]')?.value || '';
                const res = await fetch('/api/public/book', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ ...this.form, date: `${this.selectedDate}T${this.selectedTime}:00`, inspectorId: this.selectedInspector.id, agentId: this.agentId || undefined, turnstileToken })
                });
                if (res.ok) { this.success = true; window.scrollTo({ top: 0, behavior: 'smooth' }); }
            } catch (e) { console.error('Booking Error:', e); } finally { this.submitting = false; }
        }
    }));
});
