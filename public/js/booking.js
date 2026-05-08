// Sprint 1 Sub-spec C — public booking page Alpine handler.
//
// Owns:
//   * date input formatting/validation (C-1) — keeps placeholder "MM / DD / YYYY"
//     stable across locales, validates the parsed Date is real and in the future
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
        dateMasked: '',          // "MM / DD / YYYY" string the user types
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

        formatDate(e) {
            // Strip non-digits, cap at MMDDYYYY, then re-insert slashes with spaces.
            const v = (e.target.value || '').replace(/\D/g, '').slice(0, 8);
            let out = v;
            if (v.length > 4)      out = v.slice(0, 2) + ' / ' + v.slice(2, 4) + ' / ' + v.slice(4);
            else if (v.length > 2) out = v.slice(0, 2) + ' / ' + v.slice(2);
            this.dateMasked = out;
            // Clear the error eagerly while the user is fixing the field.
            if (this.dateError) this.dateError = '';
        },

        validateDate() {
            this.dateError = '';
            if (!this.dateMasked) return;
            const m = this.dateMasked.match(/^(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})$/);
            if (!m) { this.dateError = 'Please enter the date as MM / DD / YYYY'; return; }
            const month = parseInt(m[1], 10);
            const day   = parseInt(m[2], 10);
            const year  = parseInt(m[3], 10);
            const dt = new Date(year, month - 1, day);
            if (isNaN(dt.getTime()) ||
                dt.getFullYear() !== year ||
                dt.getMonth() !== month - 1 ||
                dt.getDate() !== day) {
                this.dateError = 'Please enter a valid date';
                return;
            }
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            if (dt < today) {
                this.dateError = 'Please pick a date that is not in the past';
            }
        },

        toIsoDate() {
            const m = (this.dateMasked || '').match(/^(\d{2})\s*\/\s*(\d{2})\s*\/\s*(\d{4})$/);
            if (!m) return null;
            return `${m[3]}-${m[1]}-${m[2]}`;
        },

        async submitBooking() {
            this.message = '';
            this.validateDate();
            if (this.dateError) return;
            const isoDate = this.toIsoDate();
            if (!isoDate) { this.dateError = 'Please enter the date as MM / DD / YYYY'; return; }
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

                const res = await fetch('/api/public/book', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                });
                if (res.ok) {
                    this.message   = 'Inspection requested — check your email for confirmation.';
                    this.messageOk = true;
                    form.reset();
                    this.dateMasked = '';
                    this.selectedWindow = '';
                    this.customTime = '';
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
