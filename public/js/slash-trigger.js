// Slash-trigger comment-snippet picker — handoff-decisions §4.
//
// Type "/" at the start of a line in any opted-in textarea (or the very first
// character) and a comment-library picker opens 150ms later. ESC, backspace,
// or blur cancels. Pure character-position check — no soft-line-start.
//
// Wire it on a textarea by adding the data attribute:
//   <textarea data-slash-trigger="true"
//             data-slash-section="Roof"        (optional)
//             data-slash-rating="defect" ...>  (optional)
//
// Vanilla DOM (no Alpine.data) so it composes cleanly with parent x-data
// scopes — the existing form-renderer textarea wraps in `x-data="form"`
// and uses `x-model="results[item.id].notes"`; we just attach listeners
// to the same element without owning its data.
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

    // Per-textarea state. Stored on the element so a re-attach is a no-op.
    function attach(ta) {
        if (ta.__slashAttached) return;
        ta.__slashAttached = true;

        // Read config lazily — Alpine x-bind:data-* may not have set the
        // attribute when attach() runs (MutationObserver can fire before
        // Alpine flushes its bindings).
        const readConfig = () => ({
            section: ta.dataset.slashSection || undefined,
            rating: ta.dataset.slashRating || undefined,
        });

        const state = {
            slashPos: -1,
            filter: '',
            debounceTimer: null,
            allItems: [],
            visibleItems: [],
            highlighted: 0,
            picker: null,
            isOpen: false,
        };
        ta.__slashState = state;

        function ensurePicker() {
            if (state.picker) return state.picker;
            const parent = ta.parentElement;
            if (!parent) return null;
            // Caller is expected to provide a `position: relative` parent
            // (form-renderer's `<div class="relative group mb-8">` qualifies).
            const p = document.createElement('div');
            p.className = 'oi-slash-picker absolute z-50 bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden hidden';
            p.style.minWidth = '320px';
            p.style.maxWidth = '480px';
            p.setAttribute('role', 'listbox');
            const header = document.createElement('div');
            header.className = 'px-4 py-2 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400 bg-slate-50 border-b border-slate-100';
            header.textContent = 'Comment library · / to search';
            p.appendChild(header);
            const ul = document.createElement('ul');
            ul.className = 'max-h-72 overflow-y-auto';
            p.appendChild(ul);
            const footer = document.createElement('div');
            footer.className = 'px-4 py-2 text-[10px] text-slate-400 bg-slate-50 border-t border-slate-100 flex justify-between';
            footer.innerHTML = '<span><kbd class="px-1 py-0.5 bg-white border rounded text-[10px] font-mono">↑↓</kbd> nav · <kbd class="px-1 py-0.5 bg-white border rounded text-[10px] font-mono">⏎</kbd> insert · <kbd class="px-1 py-0.5 bg-white border rounded text-[10px] font-mono">Esc</kbd> close</span>';
            p.appendChild(footer);
            parent.appendChild(p);
            state.picker = p;
            return p;
        }

        function position() {
            const p = state.picker;
            if (!p) return;
            const r = ta.getBoundingClientRect();
            const parent = ta.parentElement;
            const pr = parent ? parent.getBoundingClientRect() : { top: 0, left: 0 };
            p.style.top = `${r.bottom - pr.top + 4}px`;
            p.style.left = `${r.left - pr.left}px`;
        }

        function render() {
            const p = ensurePicker();
            if (!p) return;
            const ul = p.querySelector('ul');
            ul.innerHTML = '';
            state.visibleItems.forEach((item, idx) => {
                const li = document.createElement('li');
                li.className = 'px-4 py-2 cursor-pointer text-sm transition-colors ' + (idx === state.highlighted ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50');
                li.setAttribute('role', 'option');
                li.setAttribute('data-idx', String(idx));
                // Truncate long snippets visually
                li.textContent = (item.text || item.title || '(snippet)').slice(0, 200);
                li.addEventListener('mousedown', (e) => {
                    // Use mousedown so click happens before blur close.
                    e.preventDefault();
                    state.highlighted = idx;
                    insert();
                });
                li.addEventListener('mouseenter', () => {
                    state.highlighted = idx;
                    render();
                });
                ul.appendChild(li);
            });
            position();
        }

        function applyFilter() {
            const f = state.filter.trim().toLowerCase();
            state.visibleItems = !f ? state.allItems
                : state.allItems.filter((c) => (c.text || c.title || '').toLowerCase().includes(f));
            if (state.visibleItems.length === 0) {
                close();
                return;
            }
            state.highlighted = 0;
            render();
        }

        function open() {
            if (state.isOpen) return;
            state.isOpen = true;
            const p = ensurePicker();
            if (!p) return;
            p.classList.remove('hidden');
            position();
            // Notify the page (e.g. inspection-edit) so it can hide the
            // ACTIVE ITEM right pane to avoid showing the same canned
            // comments twice. inspection-edit listens via window event +
            // sets `slashPickerOpen` on the editor data.
            window.dispatchEvent(new CustomEvent('oi:slash-picker', { detail: { open: true } }));
        }

        function close() {
            state.isOpen = false;
            state.slashPos = -1;
            state.filter = '';
            state.allItems = [];
            state.visibleItems = [];
            if (state.debounceTimer) {
                clearTimeout(state.debounceTimer);
                state.debounceTimer = null;
            }
            if (state.picker) state.picker.classList.add('hidden');
            window.dispatchEvent(new CustomEvent('oi:slash-picker', { detail: { open: false } }));
        }

        function scheduleOpen() {
            if (state.debounceTimer) clearTimeout(state.debounceTimer);
            state.debounceTimer = setTimeout(async () => {
                if (state.slashPos < 0 || ta.value[state.slashPos] !== '/') return;
                open();
                state.allItems = await fetchSnippets(readConfig());
                applyFilter();
            }, DEBOUNCE_MS);
        }

        function insert() {
            const item = state.visibleItems[state.highlighted];
            if (!item) return;
            const before = ta.value.slice(0, state.slashPos);
            const after = ta.value.slice(ta.selectionStart);
            const text = item.text || item.title || '';
            ta.value = before + text + after;
            const newCursor = before.length + text.length;
            ta.selectionStart = ta.selectionEnd = newCursor;
            // Bubble for x-model + per-textarea input handlers.
            ta.dispatchEvent(new Event('input', { bubbles: true }));
            ta.focus();
            close();
        }

        ta.addEventListener('input', () => {
            if (!state.isOpen) {
                // Just-inserted "/"? selectionStart points right after it.
                const slashIdx = ta.selectionStart - 1;
                if (slashIdx >= 0 && ta.value[slashIdx] === '/') {
                    // Line-start = slash is the very first char OR the char
                    // immediately before it is a newline.
                    const atLineStart = slashIdx === 0 || ta.value[slashIdx - 1] === '\n';
                    if (atLineStart) {
                        state.slashPos = slashIdx;
                        state.filter = '';
                        scheduleOpen();
                    }
                }
                return;
            }
            const after = ta.value.slice(state.slashPos + 1, ta.selectionStart);
            if (after.includes('\n') || ta.selectionStart <= state.slashPos) {
                close();
                return;
            }
            state.filter = after;
            applyFilter();
        });

        ta.addEventListener('keydown', (e) => {
            if (!state.isOpen) return;
            if (e.key === 'Escape') {
                close();
                e.preventDefault();
                return;
            }
            if (e.key === 'ArrowDown') {
                state.highlighted = Math.min(state.highlighted + 1, state.visibleItems.length - 1);
                render();
                e.preventDefault();
            } else if (e.key === 'ArrowUp') {
                state.highlighted = Math.max(state.highlighted - 1, 0);
                render();
                e.preventDefault();
            } else if (e.key === 'Enter' || e.key === 'Tab') {
                if (state.visibleItems.length > 0) {
                    insert();
                    e.preventDefault();
                }
            }
        });

        ta.addEventListener('blur', () => {
            // Delay so a mousedown on a picker item still registers.
            setTimeout(() => { close(); }, 120);
        });
    }

    function scan(root = document) {
        root.querySelectorAll('textarea[data-slash-trigger]').forEach(attach);
    }

    // Initial scan + observe future inserts (form-renderer adds textareas
    // dynamically as Alpine renders inspection items).
    function start() {
        scan();
        const obs = new MutationObserver((records) => {
            for (const rec of records) {
                rec.addedNodes.forEach((node) => {
                    if (node.nodeType !== 1) return;
                    if (node.matches?.('textarea[data-slash-trigger]')) attach(node);
                    scan(node);
                });
            }
        });
        obs.observe(document.body, { childList: true, subtree: true });
    }

    // Re-export the helper so other code (tests, other plugins) can use it.
    window.OISlashTrigger = { isLineStart, attach };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start);
    } else {
        start();
    }
})();
