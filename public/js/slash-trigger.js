// Slash-trigger comment-snippet picker — handoff-decisions §4.
//
// Type "/" at the start of a line in any opted-in textarea (or the very first
// character) and a comment-library picker opens 150ms later. ESC, backspace,
// or blur cancels. Pure character-position check — no soft-line-start.
//
// Wire it on a textarea by adding the Alpine x-data binding:
//   <textarea x-data="slashSnippet({ section: 'roof', rating: 'defect' })" ...>
// `section` and `rating` filter the snippet library; both are optional.
//
// Requires window.OIHotkeys (loaded by hotkeys.js, before Alpine).

(function () {
    'use strict';

    const DEBOUNCE_MS = 150;

    function isLineStart(textarea) {
        const pos = textarea.selectionStart;
        if (pos === 0) return true;
        return textarea.value[pos - 1] === '\n';
    }

    async function fetchSnippets({ section, rating }) {
        const params = new URLSearchParams();
        if (section) params.set('section', section);
        if (rating) params.set('rating', rating);
        const qs = params.toString();
        try {
            const res = await fetch('/api/admin/comments' + (qs ? '?' + qs : ''), {
                credentials: 'same-origin',
            });
            if (!res.ok) return [];
            const json = await res.json();
            return (json?.data?.comments || []).slice(0, 30);
        } catch {
            return [];
        }
    }

    function init() {
        if (!window.Alpine) return;

        // Re-export the helper so other code (tests, other Alpine plugins) can use it.
        window.OISlashTrigger = { isLineStart };

        Alpine.data('slashSnippet', (config = {}) => ({
            open: false,
            loading: false,
            items: [],
            highlighted: 0,
            // Position the picker absolutely below the textarea — caller wraps
            // the <textarea> in a `position: relative` parent so x-show works.
            anchorTop: 0,
            anchorLeft: 0,
            // Internals
            _slashPos: -1,
            _debounceTimer: null,
            _filter: '',

            init() {
                this.$el.addEventListener('keydown', (e) => this.onKeydown(e));
                this.$el.addEventListener('input', () => this.onInput());
                this.$el.addEventListener('blur', () => {
                    // Slight delay so click on a picker item still registers.
                    setTimeout(() => { this.close(); }, 100);
                });
            },

            onInput() {
                const ta = this.$el;
                if (!this.open) {
                    if (ta.value[ta.selectionStart - 1] === '/' && this._wasLineStart(ta)) {
                        this._slashPos = ta.selectionStart - 1;
                        this._filter = '';
                        this._scheduleOpen();
                    }
                    return;
                }
                // Track typing after the slash.
                const after = ta.value.slice(this._slashPos + 1, ta.selectionStart);
                if (after.includes('\n') || ta.selectionStart <= this._slashPos) {
                    this.close();
                    return;
                }
                this._filter = after;
                this.applyFilter();
            },

            _wasLineStart(ta) {
                // The `/` is already inserted at selectionStart - 1. Line-start
                // = there is either no char before it, or the prior char is a newline.
                const slash = ta.selectionStart - 1;
                if (slash === 0) return true;
                return ta.value[slash - 1] === '\n';
            },

            _scheduleOpen() {
                if (this._debounceTimer) clearTimeout(this._debounceTimer);
                this._debounceTimer = setTimeout(async () => {
                    // Bail if the user already typed past the slash with a
                    // character that disqualifies a trigger (e.g. another '/').
                    const ta = this.$el;
                    if (this._slashPos < 0) return;
                    if (ta.value[this._slashPos] !== '/') return;
                    this.open = true;
                    this.loading = true;
                    this._positionPicker();
                    const items = await fetchSnippets(config);
                    this.items = items;
                    this.loading = false;
                    this.applyFilter();
                }, DEBOUNCE_MS);
            },

            _positionPicker() {
                // Anchor below the textarea; cheap and predictable.
                const r = this.$el.getBoundingClientRect();
                const parent = this.$el.parentElement;
                const pr = parent ? parent.getBoundingClientRect() : { top: 0, left: 0 };
                this.anchorTop = r.bottom - pr.top + 4;
                this.anchorLeft = r.left - pr.left;
            },

            applyFilter() {
                const f = this._filter.trim().toLowerCase();
                const all = this._allItems || (this._allItems = this.items);
                if (!f) {
                    this.items = all;
                } else {
                    this.items = all.filter((c) =>
                        (c.text || c.title || '').toLowerCase().includes(f)
                    );
                }
                if (this.items.length === 0) this.close();
                else this.highlighted = 0;
            },

            onKeydown(e) {
                if (!this.open) return;
                if (e.key === 'Escape') {
                    this.close();
                    e.preventDefault();
                    return;
                }
                if (e.key === 'Backspace') {
                    const ta = this.$el;
                    if (ta.selectionStart - 1 <= this._slashPos) {
                        this.close();
                    }
                    return;
                }
                if (e.key === 'ArrowDown') {
                    this.highlighted = Math.min(this.highlighted + 1, this.items.length - 1);
                    e.preventDefault();
                } else if (e.key === 'ArrowUp') {
                    this.highlighted = Math.max(this.highlighted - 1, 0);
                    e.preventDefault();
                } else if (e.key === 'Enter') {
                    const item = this.items[this.highlighted];
                    if (item) {
                        this.insert(item);
                        e.preventDefault();
                    }
                } else if (e.key === 'Tab') {
                    const item = this.items[this.highlighted];
                    if (item) {
                        this.insert(item);
                        e.preventDefault();
                    }
                }
            },

            insert(item) {
                const ta = this.$el;
                const before = ta.value.slice(0, this._slashPos);
                const after = ta.value.slice(ta.selectionStart);
                const text = item.text || item.title || '';
                ta.value = before + text + after;
                const newCursor = before.length + text.length;
                ta.selectionStart = ta.selectionEnd = newCursor;
                ta.dispatchEvent(new Event('input', { bubbles: true }));
                ta.focus();
                this.close();
            },

            close() {
                this.open = false;
                this.items = [];
                this._allItems = null;
                this._slashPos = -1;
                this._filter = '';
                if (this._debounceTimer) {
                    clearTimeout(this._debounceTimer);
                    this._debounceTimer = null;
                }
            },
        }));
    }

    if (window.Alpine) init();
    else document.addEventListener('alpine:init', init);
})();
