// Spec 3A — auto-init Flatpickr on any element with [data-flatpickr].
// Usage: <input type="text" data-flatpickr name="..." value="..." />
// Optional attrs: data-min-date="today" | data-no-time
//
// R7 fix (2026-05-07): the original code only ran once on alpine:init,
// missing inputs that get rendered later (e.g. inside modals that open
// after page load). Now we additionally apply on focus — picker mounts
// just-in-time when the user actually clicks the field.
function applyFlatpickr(el) {
    if (el._flatpickrApplied) return;
    if (typeof window.flatpickr !== 'function') return;
    el._flatpickrApplied = true;
    const enableTime = !el.hasAttribute('data-no-time');
    window.flatpickr(el, {
        enableTime,
        dateFormat:  enableTime ? 'Y-m-d H:i' : 'Y-m-d',
        time_24hr:   true,
        minDate:     el.dataset.minDate || undefined,
    });
}

function applyAll() {
    document.querySelectorAll('[data-flatpickr]').forEach(applyFlatpickr);
}

document.addEventListener('alpine:init', () => {
    if (typeof window.flatpickr !== 'function') {
        console.warn('[flatpickr-init] Flatpickr not loaded');
        return;
    }
    applyAll();
});

// Catch inputs that didn't exist on alpine:init (modal contents, dynamic
// forms). Capture phase + focusin so the picker is ready by the time the
// browser would otherwise show the native UI. applyFlatpickr is idempotent
// via the el._flatpickrApplied property — no attribute selector needed.
document.addEventListener('focusin', (e) => {
    const t = e.target;
    if (t && t.matches && t.matches('input[data-flatpickr]')) {
        applyFlatpickr(t);
    }
}, true);
