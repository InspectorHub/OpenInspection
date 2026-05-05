// public/js/inspection-events.js
// Section on the inspection edit page that lists ancillary events
// (radon pickup, sewer scope, follow-up visit) attached to this inspection.
// Requires auth.js to be loaded first (provides authFetch).

function inspectionEventsSection(inspectionId) {
    return {
        inspectionId: inspectionId,
        events: [],
        types: [],
        inspectors: [],
        loading: false,
        showCreate: false,
        saving: false,
        form: {
            eventTypeId: '',
            inspectorId: '',
            scheduledAt: '',
            durationMin: 30,
            priceCents: 0,
            notes: '',
        },

        async load() {
            await Promise.all([this.loadEvents(), this.loadTypes(), this.loadInspectors()]);
        },

        async loadEvents() {
            this.loading = true;
            try {
                const res = await authFetch('/api/inspections/' + this.inspectionId + '/events');
                if (!res.ok) throw new Error('HTTP ' + res.status);
                const json = await res.json();
                this.events = json.data || [];
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Failed to load events: ' + e.message, true);
            } finally {
                this.loading = false;
            }
        },

        async loadTypes() {
            try {
                const res = await authFetch('/api/event-types');
                if (!res.ok) return;
                const json = await res.json();
                this.types = (json.data || []).filter(function(t) { return t.active !== false; });
            } catch (_) { /* non-fatal */ }
        },

        async loadInspectors() {
            try {
                const res = await authFetch('/api/inspections/inspectors');
                if (!res.ok) return;
                const json = await res.json();
                this.inspectors = json.data?.inspectors || json.inspectors || [];
            } catch (_) { /* non-fatal */ }
        },

        eventTypeName(id) {
            const t = this.types.find(function(x) { return x.id === id; });
            return t ? t.name : id;
        },

        eventTypeColor(id) {
            const t = this.types.find(function(x) { return x.id === id; });
            return (t && t.color) || '#6366f1';
        },

        formatDate(iso) {
            if (!iso) return '';
            try { return new Date(iso).toLocaleString(); }
            catch (_) { return iso; }
        },

        statusBadgeClass(status) {
            switch (status) {
                case 'completed':        return 'bg-emerald-100 text-emerald-700';
                case 'results_received': return 'bg-indigo-100 text-indigo-700';
                case 'cancelled':        return 'bg-rose-100 text-rose-600';
                default:                 return 'bg-slate-100 text-slate-600';
            }
        },

        openCreate() {
            const firstType = this.types[0];
            this.form = {
                eventTypeId: firstType ? firstType.id : '',
                inspectorId: '',
                scheduledAt: this.defaultScheduledAt(),
                durationMin: firstType ? (firstType.defaultDurationMin || 30) : 30,
                priceCents:  firstType ? (firstType.defaultPriceCents || 0) : 0,
                notes:       '',
            };
            this.showCreate = true;
        },

        defaultScheduledAt() {
            // Default to "now + 1 hour" rounded down to the nearest 30 min, formatted for datetime-local
            const d = new Date(Date.now() + 60 * 60 * 1000);
            d.setMinutes(d.getMinutes() < 30 ? 0 : 30, 0, 0);
            const pad = function(n) { return String(n).padStart(2, '0'); };
            return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate())
                + 'T' + pad(d.getHours()) + ':' + pad(d.getMinutes());
        },

        onTypeChange() {
            const t = this.types.find(x => x.id === this.form.eventTypeId);
            if (!t) return;
            if (!this.form.durationMin || this.form.durationMin === 30) {
                this.form.durationMin = t.defaultDurationMin || 30;
            }
            if (!this.form.priceCents) {
                this.form.priceCents = t.defaultPriceCents || 0;
            }
        },

        async submitCreate() {
            if (!this.form.eventTypeId) {
                if (typeof window.showToast === 'function') window.showToast('Select an event type', true);
                return;
            }
            if (!this.form.scheduledAt) {
                if (typeof window.showToast === 'function') window.showToast('Pick a date/time', true);
                return;
            }
            this.saving = true;
            try {
                const body = {
                    eventTypeId:  this.form.eventTypeId,
                    scheduledAt:  new Date(this.form.scheduledAt).toISOString(),
                    durationMin:  parseInt(this.form.durationMin, 10) || 30,
                    priceCents:   parseInt(this.form.priceCents, 10) || 0,
                };
                if (this.form.inspectorId) body.inspectorId = this.form.inspectorId;
                if (this.form.notes)       body.notes       = this.form.notes;
                const res = await authFetch('/api/inspections/' + this.inspectionId + '/events', {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify(body),
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({}));
                    throw new Error(err?.error?.message || ('HTTP ' + res.status));
                }
                this.showCreate = false;
                if (typeof window.showToast === 'function') window.showToast('Event added');
                await this.loadEvents();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Add failed: ' + e.message, true);
            } finally {
                this.saving = false;
            }
        },

        async markComplete(id) {
            try {
                const res = await authFetch('/api/events/' + id, {
                    method:  'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body:    JSON.stringify({ status: 'completed' }),
                });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                await this.loadEvents();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Update failed: ' + e.message, true);
            }
        },

        async del(id) {
            if (!confirm('Delete this event?')) return;
            try {
                const res = await authFetch('/api/events/' + id, { method: 'DELETE' });
                if (!res.ok) throw new Error('HTTP ' + res.status);
                await this.loadEvents();
            } catch (e) {
                if (typeof window.showToast === 'function') window.showToast('Delete failed: ' + e.message, true);
            }
        },
    };
}

window.inspectionEventsSection = inspectionEventsSection;
