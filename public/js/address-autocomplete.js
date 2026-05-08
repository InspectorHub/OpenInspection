// Sprint 1 Sub-spec C-5 — Alpine handler for the public AddressAutocomplete
// component. Talks to /api/public/geocode (rate-limited, public). When the
// endpoint returns reason=NO_API_KEY or any other failure, we silently fall
// back to plain text input — the user can still type a manual address.
document.addEventListener('alpine:init', function () {
    window.Alpine.data('addressAutocomplete', function (initial) {
        return {
            value:    initial || '',
            results:  [],
            focusIdx: 0,
            selected: null,

            async search() {
                if (!this.value || this.value.length < 3) { this.results = []; return; }
                try {
                    const res = await fetch('/api/public/geocode?q=' + encodeURIComponent(this.value));
                    if (!res.ok) { this.results = []; return; }
                    const j = await res.json();
                    const payload = (j && j.data) ? j : (j && j.success && j.data ? { data: j.data, reason: j.reason } : { data: [] });
                    if (payload.reason === 'NO_API_KEY' || payload.reason === 'UPSTREAM_ERROR') {
                        // Silent fallback — input still works as plain text.
                        this.results = [];
                        return;
                    }
                    this.results = Array.isArray(payload.data) ? payload.data : [];
                    this.focusIdx = 0;
                } catch (_e) {
                    this.results = [];
                }
            },

            moveFocus(d) {
                if (this.results.length === 0) return;
                this.focusIdx = (this.focusIdx + d + this.results.length) % this.results.length;
            },

            selectFocused() {
                if (this.results[this.focusIdx]) this.select(this.results[this.focusIdx]);
            },

            select(r) {
                this.value    = r.label;
                this.selected = r;
                this.results  = [];
            },
        };
    });
});
