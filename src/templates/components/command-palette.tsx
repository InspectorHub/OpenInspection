/**
 * ⌘K Command Palette — handoff-decisions §3.
 *
 * Mounted globally from main-layout.tsx. Sources include:
 *   - top-level page jumps + every settings sub-page
 *   - recent inspections
 *   - contacts (clients + agents)
 *   - comment-library snippets
 *   - create actions (New Inspection / Template / Snippet)
 *
 * Prefix filters:
 *   "> " — actions only
 *   "@ " — people only
 *
 * Hotkey: ⌘K / Ctrl+K to toggle. Esc closes. ↑↓ navigates. ⏎ activates.
 * The global `?` HUD docs the same shortcut.
 */

export function CommandPalette(): JSX.Element {
    return (
        <div
            x-data="commandPalette"
            {...{
                'x-on:keydown.window': "const k = $event.key; const meta = $event.metaKey || $event.ctrlKey; const isTyping = window.OIHotkeys?.isTyping?.(); if (meta && k === 'k') { open = !open; if (open) { $nextTick(() => $refs.queryInput?.focus()); } $event.preventDefault(); } else if (meta && k === '/' && !isTyping) { open = !open; if (open) { $nextTick(() => $refs.queryInput?.focus()); } $event.preventDefault(); }",
                'x-on:keydown.escape.window': 'if (open) { open = false; $event.stopPropagation(); }',
                'x-cloak': '',
            }}
            x-show="open"
            class="fixed inset-0 z-[10000] flex items-start justify-center pt-[12vh] px-4"
            style="display:none"
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
        >
            <div
                class="absolute inset-0 bg-slate-900/60 backdrop-blur-sm"
                x-on:click="open = false"
                x-transition:enter="transition ease-out duration-150"
                x-transition:enter-start="opacity-0"
                x-transition:enter-end="opacity-100"
                x-transition:leave="transition ease-in duration-100"
                x-transition:leave-start="opacity-100"
                x-transition:leave-end="opacity-0"
            />
            <div
                class="relative w-full max-w-2xl bg-white rounded-md shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[70vh]"
                x-transition:enter="transition ease-out duration-150"
                x-transition:enter-start="opacity-0 scale-[0.98] translate-y-1"
                x-transition:enter-end="opacity-100 scale-100 translate-y-0"
                x-transition:leave="transition ease-in duration-100"
                x-transition:leave-start="opacity-100 scale-100"
                x-transition:leave-end="opacity-0 scale-[0.98]"
            >
                {/* Search input */}
                <div class="flex items-center gap-3 px-5 py-4 border-b border-slate-100">
                    <svg class="w-5 h-5 text-slate-400 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-4.35-4.35M16.5 10.5a6 6 0 11-12 0 6 6 0 0112 0z"></path></svg>
                    <input
                        x-ref="queryInput"
                        x-model="query"
                        x-on:keydown="onKeydown($event)"
                        type="text"
                        autocomplete="off"
                        spellcheck={false}
                        placeholder='Search · ">" actions · "@" people'
                        class="flex-1 bg-transparent border-0 text-base font-medium text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-0"
                    />
                    <kbd class="hidden sm:inline-block px-2 py-0.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-mono text-slate-500">Esc</kbd>
                </div>

                {/* Results */}
                <div class="flex-1 overflow-y-auto">
                    <template x-if="loading">
                        <div class="px-5 py-8 text-center text-xs text-slate-400">Loading…</div>
                    </template>
                    <template x-if="!loading && groups.length === 0">
                        <div class="px-5 py-12 text-center">
                            <p class="text-sm font-semibold text-slate-700">No results</p>
                            <p class="text-xs text-slate-400 mt-1">Try a different query, or press <kbd class="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded text-[10px] font-mono">Esc</kbd> to close.</p>
                        </div>
                    </template>
                    <template x-for="(group, gi) in groups" {...{ 'x-bind:key': 'group.label' }}>
                        <div>
                            <div class="px-5 pt-3 pb-1 text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400" x-text="group.label"></div>
                            <ul class="pb-1">
                                <template x-for="item in group.items" {...{ 'x-bind:key': 'item.id' }}>
                                    <li>
                                        <button
                                            type="button"
                                            x-on:mouseenter="setHighlight(item._idx)"
                                            x-on:click="run(item)"
                                            x-bind:class="highlighted === item._idx ? 'bg-indigo-50 text-indigo-700' : 'text-slate-700 hover:bg-slate-50'"
                                            class="w-full flex items-center gap-3 px-5 py-2.5 text-left text-sm font-medium transition-colors"
                                        >
                                            <span x-html="item.iconHtml" class="flex-shrink-0 w-5 h-5 text-slate-400"></span>
                                            <span class="flex-1 min-w-0 truncate" x-text="item.label"></span>
                                            <span x-show="item.hint" class="text-[11px] text-slate-400 flex-shrink-0" x-text="item.hint"></span>
                                        </button>
                                    </li>
                                </template>
                            </ul>
                        </div>
                    </template>
                </div>

                {/* Footer */}
                <div class="px-5 py-2.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-between text-[11px] text-slate-500">
                    <div class="flex items-center gap-3">
                        <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↑</kbd><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">↓</kbd> navigate</span>
                        <span class="flex items-center gap-1"><kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">⏎</kbd> open</span>
                    </div>
                    <div class="flex items-center gap-1">
                        <kbd class="px-1.5 py-0.5 bg-white border border-slate-200 rounded font-mono text-[10px]">⌘K</kbd>
                        <span>to toggle</span>
                    </div>
                </div>
            </div>
        </div>
    );
}
