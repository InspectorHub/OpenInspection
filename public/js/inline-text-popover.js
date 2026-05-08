/**
 * Inline Text Popover Alpine handler — Sprint 1 Sub-spec A Task 1.
 *
 * Exposes window.OIPrompt.open({ title, placeholder, initial, scope, onApply })
 * which displays the global popover defined in inline-text-popover.tsx.
 *
 * Per-scope history stored in localStorage as `oi.prompt.history.<scope>` —
 * the most recent 3 unique entries; clicking one populates the textarea.
 *
 * Loaded synchronously (no defer) so the alpine:init listener attaches
 * BEFORE the deferred alpine.min.js fires that event — same pattern as
 * slash-trigger.js / command-palette.js.
 */
(function () {
    var HISTORY_KEY = 'oi.prompt.history';
    var MAX_HISTORY = 3;

    function loadHistory(scope) {
        try {
            var raw = localStorage.getItem(HISTORY_KEY + '.' + scope);
            return raw ? JSON.parse(raw) : [];
        } catch (e) {
            return [];
        }
    }

    function saveHistory(scope, value) {
        try {
            var list = loadHistory(scope);
            list = [value].concat(list.filter(function (x) { return x !== value; })).slice(0, MAX_HISTORY);
            localStorage.setItem(HISTORY_KEY + '.' + scope, JSON.stringify(list));
        } catch (e) { /* ignore quota errors */ }
    }

    document.addEventListener('alpine:init', function () {
        if (!window.Alpine || typeof window.Alpine.data !== 'function') return;
        window.Alpine.data('oiPrompt', function () {
            return {
                open:        false,
                title:       '',
                placeholder: '',
                value:       '',
                scope:       'default',
                history:     [],
                // Competitor parity C3 — quick-pick instruction templates.
                // Render as small chips above the textarea; clicking a chip
                // populates the textarea with the chip text.
                templates:   [],
                _onApply:    null,

                show: function (opts) {
                    opts = opts || {};
                    this.title       = opts.title || '';
                    this.placeholder = opts.placeholder || '';
                    this.value       = opts.initial || '';
                    this.scope       = opts.scope || 'default';
                    this.history     = loadHistory(this.scope);
                    this.templates   = Array.isArray(opts.templates) ? opts.templates.slice(0, 6) : [];
                    this._onApply    = opts.onApply || null;
                    this.open        = true;
                    var self = this;
                    setTimeout(function () {
                        if (self.$refs && self.$refs.ta) {
                            self.$refs.ta.focus();
                            // place cursor at end of any pre-filled text
                            var len = (self.value || '').length;
                            try { self.$refs.ta.setSelectionRange(len, len); } catch (e) { /* ignore */ }
                        }
                    }, 50);
                },

                pickTemplate: function (text) {
                    this.value = text || '';
                    var self = this;
                    if (self.$refs && self.$refs.ta) {
                        self.$refs.ta.focus();
                        var len = (self.value || '').length;
                        try { self.$refs.ta.setSelectionRange(len, len); } catch (e) { /* ignore */ }
                    }
                },

                apply: function () {
                    var v = (this.value || '').trim();
                    if (!v) return;
                    saveHistory(this.scope, v);
                    var cb = this._onApply;
                    this.close();
                    if (cb) {
                        try { cb(v); } catch (e) { console.error('[OIPrompt] onApply threw', e); }
                    }
                },

                close: function () {
                    this.open      = false;
                    this.value     = '';
                    this.templates = [];
                    this._onApply  = null;
                },
            };
        });
    });

    // Global API: window.OIPrompt.open({ title, placeholder, initial, scope, onApply })
    window.OIPrompt = {
        open: function (opts) {
            var el = document.querySelector('[x-data="oiPrompt"]');
            if (!el || !el._x_dataStack || !el._x_dataStack[0]) {
                console.warn('[OIPrompt] popover not mounted');
                return;
            }
            el._x_dataStack[0].show(opts);
        },
    };
})();
